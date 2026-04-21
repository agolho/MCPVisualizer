// web-tree-sitter 0.20.x uses a default export with a static Language subclass.
// Pinned to match the tree-sitter 0.20 ABI that tree-sitter-wasms was built against.
// @ts-ignore — 0.20.x ships CommonJS without ESM types
import Parser from "web-tree-sitter";

let parserPromise: Promise<any> | null = null;

async function getParser(): Promise<any> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init();
      const wasmPath = require.resolve("tree-sitter-wasms/out/tree-sitter-c_sharp.wasm");
      const Lang = await Parser.Language.load(wasmPath);
      const p = new Parser();
      p.setLanguage(Lang);
      return p;
    })();
  }
  return parserPromise;
}

export type SymbolKind = "class" | "struct" | "interface" | "enum";

export interface ParsedMethod {
  name: string;
  line: number;
  isStatic: boolean;
  isPublic: boolean;
  /** Method calls observed inside this method's body. */
  calls: ParsedCall[];
}

export interface ParsedCall {
  /** The method name being invoked, e.g. "Move" from `player.Move(...)`. */
  name: string;
  /**
   * The qualifier expression before the method name, trimmed to the LAST simple identifier.
   * - `player.Move()` -> "player"
   * - `this.player.Move()` -> "player"
   * - `PlayerManager.Instance.Move()` -> "Instance"
   * - `Move()` (no qualifier) -> null (self-call)
   * - `ClassName.Static()` -> "ClassName"
   */
  qualifier: string | null;
  /** Best-effort class name hint: if the call looks like `TypeName.Static()` we record TypeName. */
  typeHint: string | null;
  line: number;
}

export interface ParsedSerializedField {
  name: string;
  /** `Player`, `List<Enemy>`, `Transform[]` — exact source text */
  rawType: string;
  /** Candidate simple names to resolve against the repo. Covers arrays and generic inners. */
  candidates: string[];
  line: number;
}

export interface ParsedComponentRef {
  /** Method called — "GetComponent", "GetComponentInChildren", "FindObjectOfType", etc. */
  method: string;
  /** Type argument T */
  typeName: string;
  candidates: string[];
  line: number;
}

export interface ParsedType {
  name: string;
  fullName: string;
  namespace?: string;
  kind: SymbolKind;
  bases: string[];
  methods: ParsedMethod[];
  serializedFields: ParsedSerializedField[];
  componentRefs: ParsedComponentRef[];
  /** Maps this class's field/property simple name -> its declared raw type (e.g. "player" -> "Player"). */
  memberTypes: Record<string, string>;
  line: number;
  isStatic: boolean;
  hasEditorAttr: boolean;
}

export interface ParsedFile {
  types: ParsedType[];
  loc: number;
}

const UNITY_COMPONENT_LOOKUPS = new Set([
  "GetComponent",
  "GetComponentInChildren",
  "GetComponentInParent",
  "GetComponents",
  "GetComponentsInChildren",
  "GetComponentsInParent",
  "FindObjectOfType",
  "FindAnyObjectOfType",
  "FindObjectsOfType",
  "FindFirstObjectByType",
  "FindAnyObjectByType",
  "FindObjectsByType",
]);

export async function parseCsFile(source: string): Promise<ParsedFile> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree) return { types: [], loc: source.split("\n").length };
  const loc = source.split("\n").length;
  const types: ParsedType[] = [];
  walk(tree.rootNode, null, types);
  return { types, loc };
}

function textOf(n: any): string {
  return n?.text ?? "";
}

/** Returns the "head" identifier of a type expression. `List<Player>` -> "List". */
function typeHead(raw: string): string {
  const s = raw.replace(/\[\]/g, "").trim();
  const lt = s.indexOf("<");
  return (lt === -1 ? s : s.slice(0, lt)).trim();
}

/** Returns candidate simple names to resolve. For `List<Player>` returns ["List","Player"]. */
function typeCandidates(raw: string): string[] {
  const out = new Set<string>();
  const s = raw.replace(/\[\]/g, "").replace(/\?/g, "").trim();
  // Head
  const head = typeHead(s);
  if (head) out.add(stripQualifier(head));
  // Any identifiers inside generic brackets
  const inside = s.match(/<([^<>]+)>/g) ?? [];
  for (const g of inside) {
    for (const part of g.slice(1, -1).split(",")) {
      const cleaned = part.trim().replace(/\[\]/g, "").replace(/\?/g, "");
      if (cleaned) out.add(stripQualifier(typeHead(cleaned)));
    }
  }
  return [...out].filter(Boolean);
}

function stripQualifier(s: string): string {
  const i = s.lastIndexOf(".");
  return i === -1 ? s : s.slice(i + 1);
}

function walk(node: any, currentNs: string | null, out: ParsedType[]) {
  const t = node.type as string;

  if (t === "namespace_declaration" || t === "file_scoped_namespace_declaration") {
    const nameNode =
      node.childForFieldName?.("name") ?? findChild(node, ["identifier", "qualified_name"]);
    const ns = nameNode ? textOf(nameNode) : currentNs;
    for (const c of iterChildren(node)) walk(c, ns, out);
    return;
  }

  const isTypeDecl =
    t === "class_declaration" ||
    t === "struct_declaration" ||
    t === "interface_declaration" ||
    t === "enum_declaration";

  if (isTypeDecl) {
    const nameNode = node.childForFieldName?.("name") ?? findChild(node, ["identifier"]);
    if (!nameNode) {
      for (const c of iterChildren(node)) walk(c, currentNs, out);
      return;
    }
    const kind: SymbolKind =
      t === "class_declaration" ? "class" :
      t === "struct_declaration" ? "struct" :
      t === "interface_declaration" ? "interface" : "enum";

    const name = textOf(nameNode);
    const fullName = currentNs ? `${currentNs}.${name}` : name;
    const modifiers = collectModifiers(node);
    const isStatic = modifiers.includes("static");
    const hasEditorAttr = collectAttributes(node).some((a) =>
      /^(CustomEditor|CustomPropertyDrawer|MenuItem|InitializeOnLoad)/.test(a)
    );

    const bases: string[] = [];
    const baseList = findChild(node, ["base_list"]);
    if (baseList) {
      for (const b of iterChildren(baseList)) {
        if (
          b.type === "identifier" ||
          b.type === "qualified_name" ||
          b.type === "generic_name" ||
          b.type === "predefined_type"
        ) {
          bases.push(textOf(b));
        }
      }
    }

    const methods: ParsedMethod[] = [];
    const serializedFields: ParsedSerializedField[] = [];
    const componentRefs: ParsedComponentRef[] = [];
    const memberTypes: Record<string, string> = {};
    const body =
      node.childForFieldName?.("body") ??
      findChild(node, ["declaration_list", "enum_member_declaration_list"]);
    if (body) {
      for (const m of iterChildren(body)) {
        if (m.type === "method_declaration" || m.type === "constructor_declaration") {
          const mName = m.childForFieldName?.("name") ?? findChild(m, ["identifier"]);
          if (mName) {
            const mods = collectModifiers(m);
            const calls: ParsedCall[] = [];
            walkForCalls(m, calls);
            methods.push({
              name: textOf(mName),
              line: (m.startPosition?.row ?? 0) + 1,
              isStatic: mods.includes("static"),
              isPublic: mods.includes("public"),
              calls,
            });
          }
          // Dig into method body for GetComponent<T>() / FindObjectOfType<T>()
          walkForComponentRefs(m, componentRefs);
        } else if (m.type === "field_declaration") {
          const sf = parseSerializedField(m);
          if (sf) serializedFields.push(sf);
          collectFieldTypes(m, memberTypes);
        } else if (m.type === "property_declaration") {
          const sp = parseSerializedProperty(m);
          if (sp) serializedFields.push(sp);
          collectPropertyType(m, memberTypes);
        }
        // Recurse for nested types
        walk(m, currentNs, out);
      }
    }

    out.push({
      name,
      namespace: currentNs ?? undefined,
      fullName,
      kind,
      bases,
      methods,
      serializedFields,
      componentRefs,
      memberTypes,
      line: (node.startPosition?.row ?? 0) + 1,
      isStatic,
      hasEditorAttr,
    });
    return;
  }

  for (const c of iterChildren(node)) walk(c, currentNs, out);
}

function parseSerializedField(fieldNode: any): ParsedSerializedField | null {
  const attrs = collectAttributes(fieldNode);
  if (!attrs.some((a) => a === "SerializeField" || a.startsWith("SerializeField"))) return null;
  const decl = findChild(fieldNode, ["variable_declaration"]);
  if (!decl) return null;
  const typeNode = decl.childForFieldName?.("type") ?? findFirstChildAny(decl, TYPE_NODE_TYPES);
  if (!typeNode) return null;
  const declarator = findChild(decl, ["variable_declarator"]);
  const nameNode = declarator
    ? (declarator.childForFieldName?.("name") ?? findChild(declarator, ["identifier"]))
    : null;
  const rawType = textOf(typeNode);
  return {
    name: nameNode ? textOf(nameNode) : "?",
    rawType,
    candidates: typeCandidates(rawType),
    line: (fieldNode.startPosition?.row ?? 0) + 1,
  };
}

function parseSerializedProperty(propNode: any): ParsedSerializedField | null {
  const attrs = collectAttributes(propNode);
  if (!attrs.some((a) => a === "SerializeField" || a.startsWith("SerializeField"))) return null;
  const typeNode = propNode.childForFieldName?.("type") ?? findFirstChildAny(propNode, TYPE_NODE_TYPES);
  const nameNode = propNode.childForFieldName?.("name") ?? findChild(propNode, ["identifier"]);
  if (!typeNode) return null;
  const rawType = textOf(typeNode);
  return {
    name: nameNode ? textOf(nameNode) : "?",
    rawType,
    candidates: typeCandidates(rawType),
    line: (propNode.startPosition?.row ?? 0) + 1,
  };
}

const TYPE_NODE_TYPES = [
  "predefined_type",
  "identifier",
  "qualified_name",
  "generic_name",
  "array_type",
  "nullable_type",
  "pointer_type",
  "tuple_type",
  "implicit_type",
];

/**
 * Walks a method body collecting method-call sites. Resolves the invocation's
 * function expression into a (qualifier, name, typeHint) triple — enough for
 * graph.ts to resolve the target class best-effort later.
 */
function walkForCalls(node: any, out: ParsedCall[]) {
  if (node.type === "invocation_expression") {
    const fn = node.childForFieldName?.("function") ?? null;
    const info = extractCallTarget(fn);
    if (info) {
      out.push({
        name: info.name,
        qualifier: info.qualifier,
        typeHint: info.typeHint,
        line: (node.startPosition?.row ?? 0) + 1,
      });
    }
    // Don't recurse into the function expression itself, but DO recurse into
    // the argument list so chained / nested calls are all captured.
    const args = node.childForFieldName?.("arguments") ?? findChild(node, ["argument_list"]);
    if (args) walkForCalls(args, out);
    return;
  }
  for (const c of iterChildren(node)) walkForCalls(c, out);
}

/**
 * Given a function expression node, returns the called method name, the last
 * identifier qualifier before it (if any), and — when the qualifier *looks like*
 * a type (starts with a capital letter and nothing else precedes it) — a type hint.
 */
function extractCallTarget(
  fn: any
): { name: string; qualifier: string | null; typeHint: string | null } | null {
  if (!fn) return null;

  if (fn.type === "identifier") {
    // Bare call: `Foo()`. No qualifier; could be self-call or using-imported static.
    return { name: textOf(fn), qualifier: null, typeHint: null };
  }

  if (fn.type === "generic_name") {
    const nameNode = fn.childForFieldName?.("name") ?? findChild(fn, ["identifier"]);
    const name = nameNode ? textOf(nameNode) : "";
    if (!name) return null;
    return { name, qualifier: null, typeHint: null };
  }

  if (fn.type === "member_access_expression") {
    const exprNode = fn.childForFieldName?.("expression") ?? null;
    const nameNode = fn.childForFieldName?.("name") ?? null;
    if (!nameNode) return null;

    let methodName: string;
    if (nameNode.type === "generic_name") {
      const inner = nameNode.childForFieldName?.("name") ?? findChild(nameNode, ["identifier"]);
      methodName = inner ? textOf(inner) : "";
    } else {
      methodName = textOf(nameNode);
    }
    if (!methodName) return null;

    const qualifier = exprNode ? lastIdentifier(exprNode) : null;
    let typeHint: string | null = null;
    if (exprNode && exprNode.type === "identifier") {
      const t = textOf(exprNode);
      if (t && /^[A-Z]/.test(t)) typeHint = t;
    }
    return { name: methodName, qualifier, typeHint };
  }

  return null;
}

/** Walks any expression subtree and returns the text of the rightmost simple identifier. */
function lastIdentifier(node: any): string | null {
  if (!node) return null;
  if (node.type === "identifier") return textOf(node) || null;
  if (node.type === "this_expression") return "this";
  if (node.type === "member_access_expression") {
    const nameNode = node.childForFieldName?.("name") ?? null;
    if (nameNode && nameNode.type === "identifier") return textOf(nameNode) || null;
    if (nameNode && nameNode.type === "generic_name") {
      const inner = nameNode.childForFieldName?.("name") ?? findChild(nameNode, ["identifier"]);
      return inner ? textOf(inner) : null;
    }
  }
  // For anything else (invocation, element_access, cast, etc.) scan the last child.
  const n = node.childCount ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    const c = node.child ? node.child(i) : null;
    if (!c) continue;
    const r = lastIdentifier(c);
    if (r) return r;
  }
  return null;
}

function collectFieldTypes(fieldNode: any, out: Record<string, string>): void {
  const decl = findChild(fieldNode, ["variable_declaration"]);
  if (!decl) return;
  const typeNode = decl.childForFieldName?.("type") ?? findFirstChildAny(decl, TYPE_NODE_TYPES);
  if (!typeNode) return;
  const rawType = textOf(typeNode);
  for (const c of iterChildren(decl)) {
    if (c.type === "variable_declarator") {
      const nameNode = c.childForFieldName?.("name") ?? findChild(c, ["identifier"]);
      if (nameNode) out[textOf(nameNode)] = rawType;
    }
  }
}

function collectPropertyType(propNode: any, out: Record<string, string>): void {
  const typeNode = propNode.childForFieldName?.("type") ?? findFirstChildAny(propNode, TYPE_NODE_TYPES);
  const nameNode = propNode.childForFieldName?.("name") ?? findChild(propNode, ["identifier"]);
  if (typeNode && nameNode) {
    out[textOf(nameNode)] = textOf(typeNode);
  }
}

function walkForComponentRefs(node: any, out: ParsedComponentRef[]) {
  if (node.type === "invocation_expression") {
    const fn = node.childForFieldName?.("function") ?? findFirstChildAny(node, ["generic_name", "member_access_expression", "identifier"]);
    const { methodName, genericNode } = resolveInvocationTarget(fn);
    if (methodName && UNITY_COMPONENT_LOOKUPS.has(methodName) && genericNode) {
      const typeArgs = findChild(genericNode, ["type_argument_list"]);
      if (typeArgs) {
        for (const ta of iterChildren(typeArgs)) {
          if (TYPE_NODE_TYPES.includes(ta.type) || ta.type === "identifier") {
            const raw = textOf(ta);
            if (!raw) continue;
            out.push({
              method: methodName,
              typeName: raw,
              candidates: typeCandidates(raw),
              line: (node.startPosition?.row ?? 0) + 1,
            });
            break; // usually 1 type arg for these calls
          }
        }
      }
    }
  }
  for (const c of iterChildren(node)) walkForComponentRefs(c, out);
}

/** For an invocation's function expression, return the method name + the generic_name holding the type args (if any). */
function resolveInvocationTarget(fn: any): { methodName: string | null; genericNode: any | null } {
  if (!fn) return { methodName: null, genericNode: null };
  if (fn.type === "generic_name") {
    const nameNode = fn.childForFieldName?.("name") ?? findChild(fn, ["identifier"]);
    return { methodName: nameNode ? textOf(nameNode) : null, genericNode: fn };
  }
  if (fn.type === "identifier") {
    return { methodName: textOf(fn), genericNode: null };
  }
  if (fn.type === "member_access_expression") {
    const nameNode = fn.childForFieldName?.("name") ?? null;
    if (!nameNode) return { methodName: null, genericNode: null };
    if (nameNode.type === "generic_name") {
      const inner = nameNode.childForFieldName?.("name") ?? findChild(nameNode, ["identifier"]);
      return { methodName: inner ? textOf(inner) : null, genericNode: nameNode };
    }
    return { methodName: textOf(nameNode), genericNode: null };
  }
  return { methodName: null, genericNode: null };
}

function collectModifiers(node: any): string[] {
  const out: string[] = [];
  for (const c of iterChildren(node)) {
    if (c.type === "modifier") out.push(textOf(c));
  }
  return out;
}

function collectAttributes(node: any): string[] {
  const out: string[] = [];
  for (const c of iterChildren(node)) {
    if (c.type === "attribute_list") {
      for (const a of iterChildren(c)) {
        if (a.type === "attribute") {
          const nameNode =
            a.childForFieldName?.("name") ?? findChild(a, ["identifier", "qualified_name"]);
          if (nameNode) out.push(textOf(nameNode));
        }
      }
    }
  }
  return out;
}

function findChild(node: any, types: string[]): any | null {
  for (const c of iterChildren(node)) {
    if (types.includes(c.type)) return c;
  }
  return null;
}

function findFirstChildAny(node: any, types: string[]): any | null {
  for (const c of iterChildren(node)) {
    if (types.includes(c.type)) return c;
  }
  return null;
}

function* iterChildren(node: any): Iterable<any> {
  const n = node.childCount ?? 0;
  for (let i = 0; i < n; i++) {
    const c = node.child ? node.child(i) : null;
    if (c) yield c;
  }
}
