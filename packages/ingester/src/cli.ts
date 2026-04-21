#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { ingest } from "./ingest.js";
import { serve } from "./server.js";

function defaultDataDir(): string {
  if (process.env.MCPVIZ_DATA_DIR) return process.env.MCPVIZ_DATA_DIR;
  return path.join(os.homedir(), ".mcpviz");
}

const program = new Command();

program
  .name("mcpviz-ingest")
  .description("Ingest a Unity C# repo into a graph.json for the MCPVisualizer viz");

program
  .command("ingest", { isDefault: true })
  .argument("<source>", "Local path OR git URL (https/ssh)")
  .option("-o, --out <file>", "Output graph.json path", "./out/graph.json")
  .option("--work <dir>", "Work dir for git clones", "./.work")
  .option("--no-docs", "Skip collecting CLAUDE.md / *.md docs")
  .option("--no-symbols", "Skip tree-sitter C# parsing (folders/files only)")
  .action(async (source: string, opts) => {
    const baseCwd = process.env.INIT_CWD ?? process.cwd();
    const outPath = path.resolve(baseCwd, opts.out);
    const workDir = path.resolve(baseCwd, opts.work);
    console.log(`[mcpviz] source: ${source}`);
    const { graph } = await ingest({
      source,
      workDir,
      collectDocs: opts.docs !== false,
      parseSymbols: opts.symbols !== false,
      onProgress: (m) => console.log(`[mcpviz] ${m}`),
    });
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(graph, null, 2), "utf8");
    console.log(
      `[mcpviz] wrote ${outPath}  nodes=${graph.nodes.length}  edges=${graph.edges.length}`
    );
    if (graph.meta.warnings.length) {
      console.log(
        `[mcpviz] warnings:\n  - ${graph.meta.warnings.slice(0, 10).join("\n  - ")}` +
          (graph.meta.warnings.length > 10 ? `\n  …and ${graph.meta.warnings.length - 10} more` : "")
      );
    }
  });

program
  .command("serve")
  .description("Start the project server (multi-project, stores data under --data-dir)")
  .option("-d, --data-dir <dir>", "Where to persist projects (default: ~/.mcpviz/)")
  .option("-p, --port <n>", "Port (0 = random)", "3001")
  .option("--static <dir>", "Serve a built viz from this directory too")
  .action(async (opts) => {
    const dataDir = path.resolve(opts.dataDir ?? defaultDataDir());
    await serve({
      dataDir,
      port: Number(opts.port),
      staticDir: opts.static ? path.resolve(opts.static) : undefined,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
