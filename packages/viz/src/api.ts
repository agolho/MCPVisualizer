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
  localRootDir: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: { nodes: number; edges: number };
  viewState?: ProjectViewState;
  portable?: boolean;
}

export interface Health {
  ok: boolean;
  dataDir: string;
  projects: number;
  claudeAvailable: boolean;
}

async function json<T>(p: Promise<Response>): Promise<T> {
  const r = await p;
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const api = {
  async health(): Promise<Health | null> {
    try {
      return await json<Health>(fetch("/api/health"));
    } catch {
      return null;
    }
  },
  list(): Promise<{ projects: ProjectMeta[] }> {
    return json(fetch("/api/projects"));
  },
  get(id: string): Promise<{ meta: ProjectMeta; graph: Graph }> {
    return json(fetch(`/api/projects/${encodeURIComponent(id)}`));
  },
  getGraph(id: string): Promise<Graph> {
    return json(fetch(`/api/projects/${encodeURIComponent(id)}/graph?t=${Date.now()}`));
  },
  create(name: string, source: string): Promise<{ jobId: string }> {
    return json(
      fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, source }),
      })
    );
  },
  job(id: string): Promise<{
    id: string;
    status: "running" | "done" | "error";
    log: string[];
    projectId?: string;
    error?: string;
    startedAt: number;
    finishedAt?: number;
  }> {
    return json(fetch(`/api/jobs/${encodeURIComponent(id)}`));
  },
  delete(id: string): Promise<{ ok: true }> {
    return json(fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }));
  },
  rename(id: string, name: string): Promise<{ meta: ProjectMeta }> {
    return json(
      fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
    );
  },
  saveViewState(id: string, viewState: ProjectViewState): Promise<{ meta: ProjectMeta }> {
    return json(
      fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewState }),
      })
    );
  },
  reingest(id: string): Promise<{ ok: true; stats: { nodes: number; edges: number } }> {
    return json(
      fetch(`/api/projects/${encodeURIComponent(id)}/reingest`, { method: "POST" })
    );
  },
  exportUrl(id: string): string {
    return `/api/projects/${encodeURIComponent(id)}/export`;
  },
  importFromRaw(raw: string): Promise<{ meta: ProjectMeta }> {
    return json(
      fetch("/api/projects/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      })
    );
  },
  importFromPath(filePath: string): Promise<{ meta: ProjectMeta }> {
    return json(
      fetch("/api/projects/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath }),
      })
    );
  },
  indexHere(
    id: string,
    folderPath: string
  ): Promise<{ ok: boolean; error?: string; durationMs?: number; numTurns?: number; generated?: string }> {
    return json(
      fetch(`/api/projects/${encodeURIComponent(id)}/index-here`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath }),
      })
    );
  },
};
