import path from "node:path";
import { resolveSource } from "./source.js";
import { buildGraph } from "./graph.js";
import type { Graph } from "@mcpviz/shared";

export interface IngestOptions {
  source: string;
  workDir: string;
  collectDocs?: boolean;
  parseSymbols?: boolean;
  onProgress?: (msg: string) => void;
}

export interface IngestResult {
  graph: Graph;
  /** Absolute local path scanned (clone dir for git, resolved path otherwise). */
  rootDir: string;
  sourceMeta: Graph["meta"]["source"];
}

export async function ingest(opts: IngestOptions): Promise<IngestResult> {
  const log = opts.onProgress ?? (() => {});
  log(`resolving source: ${opts.source}`);
  const resolved = await resolveSource(opts.source, path.resolve(opts.workDir));
  log(`scanning: ${resolved.rootDir} (${resolved.meta.kind})`);
  const graph = await buildGraph(resolved, {
    collectDocs: opts.collectDocs !== false,
    parseSymbols: opts.parseSymbols !== false,
  });
  log(`built graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  return { graph, rootDir: resolved.rootDir, sourceMeta: resolved.meta };
}
