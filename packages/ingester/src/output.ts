import fs from "node:fs/promises";
import path from "node:path";
import type { Graph } from "@mcpviz/shared";

export async function writeGraph(outPath: string, graph: Graph): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), "utf8");
}
