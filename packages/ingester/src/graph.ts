import type { Graph, GraphEdge, GraphNode, UnityKind } from "@mcpviz/shared";
import type { ResolvedSource } from "./source.js";
import { walk, readUtf8, folderOf, ancestors } from "./walk.js";
import { parseCsFile, type ParsedType } from "./parse/csharp.js";
import { classifyUnityKind } from "./parse/unity.js";

export interface BuildOptions {
  collectDocs: boolean;
  parseSymbols?: boolean; // default true
}

export async function buildGraph(src: ResolvedSource, opts: BuildOptions): Promise<Graph> {
  const warnings: string[] = [];
  const { csFiles, mdFiles } = await walk(src.rootDir);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const fileCounts = new Map<string, number>();

  const ensureFolder = (folder: string): string => {
    const id = `folder:${folder}`;
    if (!nodes.has(id)) {
      const parentFolder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
      const parentId = folder === "" ? undefined : `folder:${parentFolder}`;
      nodes.set(id, {
        id,
        kind: "folder",
        label: folder === "" ? "/" : folder.split("/").pop()!,
        path: folder,
        parentId,
        fileCount: 0,
      });
      if (parentId) {
        edges.push({
          id: `${parentId}->${id}:contains`,
          source: parentId,
          target: id,
          kind: "contains",
        });
      }
    }
    return id;
  };

  ensureFolder("");

  // Pass 1: folders + file nodes
  for (const file of csFiles) {
    const folder = folderOf(file);
    for (const anc of ancestors(folder)) ensureFolder(anc);
    const folderId = ensureFolder(folder);
    fileCounts.set(folderId, (fileCounts.get(folderId) ?? 0) + 1);

    const fileId = `file:${file}`;
    nodes.set(fileId, {
      id: fileId,
      kind: "file",
      label: file.split("/").pop()!,
      path: file,
      parentId: folderId,
    });
    edges.push({
      id: `${folderId}->${fileId}:contains`,
      source: folderId,
      target: fileId,
      kind: "contains",
    });
  }

  for (const [folderId, count] of fileCounts) {
    const node = nodes.get(folderId)!;
    node.fileCount = count;
  }

  // Pass 2: docs attached to folders
  if (opts.collectDocs) {
    for (const md of mdFiles) {
      const folder = folderOf(md);
      const folderId = `folder:${folder}`;
      const node = nodes.get(folderId);
      if (!node) continue;
      try {
        const body = await readUtf8(src.rootDir, md);
        node.docs = [...(node.docs ?? []), `# ${md}\n\n${body}`];
      } catch (e) {
        warnings.push(`could not read ${md}: ${(e as Error).message}`);
      }
    }
  }

  // Pass 3: parse each C# file into symbol nodes
  let classCount = 0;
  let methodCount = 0;
  type TypeIndexEntry = {
    node: GraphNode;
    parsed: ParsedType;
    filePath: string;
    methodIdByName: Map<string, string>;
  };
  const typeByFullName = new Map<string, TypeIndexEntry>();
  const typeBySimpleName = new Map<string, TypeIndexEntry[]>();

  if (opts.parseSymbols !== false) {
    let done = 0;
    const progressEvery = Math.max(1, Math.floor(csFiles.length / 20));
    for (const file of csFiles) {
      done++;
      if (done % progressEvery === 0 || done === csFiles.length) {
        process.stderr.write(`\r[mcpviz] parsing ${done}/${csFiles.length}`);
      }
      const fileId = `file:${file}`;
      let source: string;
      try {
        source = await readUtf8(src.rootDir, file);
      } catch (e) {
        warnings.push(`read ${file}: ${(e as Error).message}`);
        continue;
      }
      let parsed;
      try {
        parsed = await parseCsFile(source);
      } catch (e) {
        warnings.push(`parse ${file}: ${(e as Error).message}`);
        continue;
      }
      nodes.get(fileId)!.loc = parsed.loc;

      for (const t of parsed.types) {
        const classId = `class:${file}#${t.fullName}`;
        const unityKind: UnityKind = classifyUnityKind(t);
        nodes.set(classId, {
          id: classId,
          kind: "class",
          label: t.name,
          path: `${file}#${t.fullName}`,
          parentId: fileId,
          unityKind,
        });
        edges.push({
          id: `${fileId}->${classId}:contains`,
          source: fileId,
          target: classId,
          kind: "contains",
        });
        classCount++;

        const methodIdByName = new Map<string, string>();
        const entry: TypeIndexEntry = {
          node: nodes.get(classId)!,
          parsed: t,
          filePath: file,
          methodIdByName,
        };
        typeByFullName.set(t.fullName, entry);
        const arr = typeBySimpleName.get(t.name) ?? [];
        arr.push(entry);
        typeBySimpleName.set(t.name, arr);

        for (const m of t.methods) {
          const methodId = `method:${file}#${t.fullName}.${m.name}@${m.line}`;
          nodes.set(methodId, {
            id: methodId,
            kind: "method",
            label: m.name,
            path: `${file}#${t.fullName}.${m.name}`,
            parentId: classId,
          });
          edges.push({
            id: `${classId}->${methodId}:contains`,
            source: classId,
            target: methodId,
            kind: "contains",
          });
          // If two methods share a name (overloads), first-wins keeps call resolution deterministic.
          if (!methodIdByName.has(m.name)) methodIdByName.set(m.name, methodId);
          methodCount++;
        }
      }
    }
    process.stderr.write("\n");

    // Pass 4: resolve edges within-repo (inherits + serialized-ref + gets-component)
    const resolveCandidates = (cands: string[]): TypeIndexEntry | undefined => {
      for (const c of cands) {
        const hit =
          typeByFullName.get(c) ??
          (typeBySimpleName.get(c)?.length === 1 ? typeBySimpleName.get(c)![0] : undefined);
        if (hit) return hit;
      }
      return undefined;
    };

    const seenEdges = new Set<string>();
    const addEdge = (source: string, target: string, kind: string, evidence?: string) => {
      const id = `${source}->${target}:${kind}`;
      if (seenEdges.has(id)) return;
      seenEdges.add(id);
      edges.push({ id, source, target, kind: kind as any, evidence });
    };

    for (const entry of typeByFullName.values()) {
      // inherits
      for (const raw of entry.parsed.bases) {
        const base = stripGenerics(raw);
        const target =
          typeByFullName.get(base) ??
          (typeBySimpleName.get(base)?.length === 1 ? typeBySimpleName.get(base)![0] : undefined);
        if (target && target.node.id !== entry.node.id) {
          addEdge(entry.node.id, target.node.id, "inherits", `${entry.filePath}:${entry.parsed.line}`);
        }
      }
      // [SerializeField] foo: SomeType  →  serialized-ref
      for (const sf of entry.parsed.serializedFields) {
        const target = resolveCandidates(sf.candidates);
        if (target && target.node.id !== entry.node.id) {
          addEdge(
            entry.node.id,
            target.node.id,
            "serialized-ref",
            `${entry.filePath}:${sf.line}  [SerializeField] ${sf.name}: ${sf.rawType}`
          );
        }
      }
      // GetComponent<T>() and friends  →  gets-component
      for (const cr of entry.parsed.componentRefs) {
        const target = resolveCandidates(cr.candidates);
        if (target && target.node.id !== entry.node.id) {
          addEdge(
            entry.node.id,
            target.node.id,
            "gets-component",
            `${entry.filePath}:${cr.line}  ${cr.method}<${cr.typeName}>`
          );
        }
      }

      // Method-call edges: for each method in this class, resolve each call site
      // to a target class (via member types or TypeName.Static hints) and emit
      // a method→method "calls" edge when we can pin down the callee too.
      for (const m of entry.parsed.methods) {
        const fromMethodId = entry.methodIdByName.get(m.name);
        if (!fromMethodId) continue;
        for (const call of m.calls) {
          // 1) Self-call: no qualifier, resolve against this class.
          let targetEntry: TypeIndexEntry | undefined;
          if (call.qualifier === null || call.qualifier === "this") {
            targetEntry = entry;
          } else if (call.typeHint) {
            // 2) `TypeName.Static()` — the qualifier literally looks like a type.
            const t = stripGenerics(call.typeHint);
            targetEntry =
              typeByFullName.get(t) ??
              (typeBySimpleName.get(t)?.length === 1 ? typeBySimpleName.get(t)![0] : undefined);
          }
          if (!targetEntry) {
            // 3) Qualifier is a field/property of the calling class — look up its type.
            const memberType = entry.parsed.memberTypes[call.qualifier ?? ""];
            if (memberType) {
              for (const cand of typeCandidatesFromRaw(memberType)) {
                const hit =
                  typeByFullName.get(cand) ??
                  (typeBySimpleName.get(cand)?.length === 1 ? typeBySimpleName.get(cand)![0] : undefined);
                if (hit) {
                  targetEntry = hit;
                  break;
                }
              }
            }
          }
          if (!targetEntry) continue;
          if (targetEntry === entry && call.qualifier === null) continue; // skip noisy self-calls

          const calleeMethodId = targetEntry.methodIdByName.get(call.name);
          if (calleeMethodId && calleeMethodId !== fromMethodId) {
            addEdge(
              fromMethodId,
              calleeMethodId,
              "calls",
              `${entry.filePath}:${call.line}  ${call.qualifier ?? ""}${call.qualifier ? "." : ""}${call.name}()`
            );
          } else if (targetEntry.node.id !== entry.node.id) {
            // Callee unknown (external/inherited), but we know the target class.
            addEdge(
              fromMethodId,
              targetEntry.node.id,
              "references",
              `${entry.filePath}:${call.line}  ${call.qualifier ?? ""}${call.qualifier ? "." : ""}${call.name}()`
            );
          }
        }
      }
    }
  }

  return {
    meta: {
      source: src.meta,
      generatedAt: new Date().toISOString(),
      stats: {
        files: csFiles.length,
        folders: [...nodes.values()].filter((n) => n.kind === "folder").length,
        classes: classCount,
        methods: methodCount,
      },
      warnings,
    },
    nodes: [...nodes.values()],
    edges,
  };
}

function stripGenerics(s: string): string {
  const i = s.indexOf("<");
  return (i === -1 ? s : s.slice(0, i)).trim();
}

/** Mirrors parse/csharp.ts#typeCandidates for use during edge resolution. */
function typeCandidatesFromRaw(raw: string): string[] {
  const out = new Set<string>();
  const s = raw.replace(/\[\]/g, "").replace(/\?/g, "").trim();
  const head = stripGenerics(s);
  if (head) out.add(stripQualifier(head));
  const inside = s.match(/<([^<>]+)>/g) ?? [];
  for (const g of inside) {
    for (const part of g.slice(1, -1).split(",")) {
      const cleaned = part.trim().replace(/\[\]/g, "").replace(/\?/g, "");
      if (cleaned) out.add(stripQualifier(stripGenerics(cleaned)));
    }
  }
  return [...out].filter(Boolean);
}

function stripQualifier(s: string): string {
  const i = s.lastIndexOf(".");
  return i === -1 ? s : s.slice(i + 1);
}
