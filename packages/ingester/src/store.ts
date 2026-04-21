import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Graph } from "@mcpviz/shared";

export interface ProjectSource {
  kind: "path" | "git";
  value: string;
  commit?: string;
}

export interface ProjectViewState {
  collapsed?: string[];
  selectedId?: string | null;
  hideContainsEdges?: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  source: ProjectSource;
  /** Absolute path on this machine where the source repo lives (rootDir). Null if portable/view-only. */
  localRootDir: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: { nodes: number; edges: number };
  viewState?: ProjectViewState;
  /** True when this project was imported as a portable snapshot (.mcpviz file). */
  portable?: boolean;
}

export interface ProjectFull {
  meta: ProjectMeta;
  graph: Graph;
}

const MAGIC = "mcpviz-project-v1";

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";
}

export class ProjectStore {
  readonly dataDir: string;
  readonly projectsDir: string;
  readonly workDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.projectsDir = path.join(dataDir, "projects");
    this.workDir = path.join(dataDir, ".work");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.projectsDir, { recursive: true });
    await fs.mkdir(this.workDir, { recursive: true });
  }

  private projectDir(id: string): string {
    return path.join(this.projectsDir, id);
  }

  async list(): Promise<ProjectMeta[]> {
    await this.init();
    const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
    const out: ProjectMeta[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const metaPath = path.join(this.projectDir(e.name), "project.json");
      try {
        const raw = await fs.readFile(metaPath, "utf8");
        out.push(JSON.parse(raw) as ProjectMeta);
      } catch {
        // skip malformed
      }
    }
    out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return out;
  }

  async get(id: string): Promise<ProjectFull> {
    const dir = this.projectDir(id);
    const [metaRaw, graphRaw] = await Promise.all([
      fs.readFile(path.join(dir, "project.json"), "utf8"),
      fs.readFile(path.join(dir, "graph.json"), "utf8"),
    ]);
    return { meta: JSON.parse(metaRaw), graph: JSON.parse(graphRaw) };
  }

  async getMeta(id: string): Promise<ProjectMeta> {
    const dir = this.projectDir(id);
    return JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
  }

  async getGraph(id: string): Promise<Graph> {
    const dir = this.projectDir(id);
    return JSON.parse(await fs.readFile(path.join(dir, "graph.json"), "utf8"));
  }

  async saveGraph(id: string, graph: Graph): Promise<void> {
    const dir = this.projectDir(id);
    await fs.writeFile(path.join(dir, "graph.json"), JSON.stringify(graph, null, 2), "utf8");
    await this.patchMeta(id, {
      updatedAt: new Date().toISOString(),
      stats: { nodes: graph.nodes.length, edges: graph.edges.length },
    });
  }

  async patchMeta(id: string, patch: Partial<ProjectMeta>): Promise<ProjectMeta> {
    const cur = await this.getMeta(id);
    const next: ProjectMeta = { ...cur, ...patch, id: cur.id, updatedAt: new Date().toISOString() };
    await fs.writeFile(
      path.join(this.projectDir(id), "project.json"),
      JSON.stringify(next, null, 2),
      "utf8"
    );
    return next;
  }

  /** Writes a new project record. Caller provides the already-built graph. */
  async create(opts: {
    name: string;
    source: ProjectSource;
    localRootDir: string | null;
    graph: Graph;
    portable?: boolean;
  }): Promise<ProjectMeta> {
    await this.init();
    const id = `${slugify(opts.name)}-${crypto.randomBytes(3).toString("hex")}`;
    const dir = this.projectDir(id);
    await fs.mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    const meta: ProjectMeta = {
      id,
      name: opts.name,
      source: opts.source,
      localRootDir: opts.localRootDir,
      createdAt: now,
      updatedAt: now,
      stats: { nodes: opts.graph.nodes.length, edges: opts.graph.edges.length },
      portable: opts.portable,
    };
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(meta, null, 2), "utf8");
    await fs.writeFile(path.join(dir, "graph.json"), JSON.stringify(opts.graph, null, 2), "utf8");
    return meta;
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.projectDir(id), { recursive: true, force: true });
  }

  /** Exportable single-file snapshot of a project. */
  async exportBundle(id: string): Promise<string> {
    const { meta, graph } = await this.get(id);
    const exportMeta: ProjectMeta = { ...meta, portable: true };
    const body = { magic: MAGIC, exportedAt: new Date().toISOString(), meta: exportMeta, graph };
    return JSON.stringify(body, null, 2);
  }

  /** Import a bundle from disk into the store. Returns the new project meta. */
  async importBundle(raw: string): Promise<ProjectMeta> {
    let parsed: { magic?: string; meta?: ProjectMeta; graph?: Graph };
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`file is not valid JSON: ${(e as Error).message}`);
    }
    if (parsed.magic !== MAGIC || !parsed.meta || !parsed.graph) {
      throw new Error(`not an mcpviz project bundle (magic=${parsed.magic ?? "missing"})`);
    }
    return this.create({
      name: parsed.meta.name,
      source: parsed.meta.source,
      localRootDir: null,
      graph: parsed.graph,
      portable: true,
    });
  }
}
