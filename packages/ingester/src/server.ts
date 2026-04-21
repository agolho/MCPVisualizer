import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import type { Graph, GraphNode } from "@mcpviz/shared";
import { runClaudeOneshot, buildIndexHerePrompt, findClaudeBinary } from "./claude.js";
import fg from "fast-glob";
import { ProjectStore, type ProjectMeta, type ProjectViewState } from "./store.js";
import { ingest } from "./ingest.js";

export interface ServerOpts {
  /** Where to persist projects. Defaults to ~/.mcpviz/ if not provided. */
  dataDir: string;
  port: number;
  /** Called once listening so the caller can learn the actual port (if port=0). */
  onListening?: (port: number) => void;
  /** Serve the built viz (index.html + assets) from this dir. Optional for dev. */
  staticDir?: string;
}

interface CreateJob {
  id: string;
  name: string;
  source: string;
  status: "running" | "done" | "error";
  log: string[];
  startedAt: number;
  finishedAt?: number;
  projectId?: string;
  error?: string;
}

export async function serve(opts: ServerOpts): Promise<{ port: number; close: () => Promise<void> }> {
  const store = new ProjectStore(opts.dataDir);
  await store.init();

  const jobs = new Map<string, CreateJob>();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "20mb" }));

  app.get("/api/health", async (_req, res) => {
    const projects = await store.list();
    res.json({
      ok: true,
      dataDir: opts.dataDir,
      projects: projects.length,
      claudeAvailable: !!findClaudeBinary(),
    });
  });

  // ----- Projects -----

  app.get("/api/projects", async (_req, res) => {
    res.json({ projects: await store.list() });
  });

  app.post("/api/projects", async (req, res) => {
    const { name, source } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name (string) required" });
      return;
    }
    if (typeof source !== "string" || !source.trim()) {
      res.status(400).json({ error: "source (string: path or git url) required" });
      return;
    }
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: CreateJob = {
      id: jobId,
      name: name.trim(),
      source: source.trim(),
      status: "running",
      log: [],
      startedAt: Date.now(),
    };
    jobs.set(jobId, job);

    (async () => {
      try {
        const result = await ingest({
          source: job.source,
          workDir: store.workDir,
          onProgress: (msg) => {
            job.log.push(msg);
            if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
          },
        });
        const localRootDir = result.sourceMeta.kind === "path" ? result.sourceMeta.value : result.rootDir;
        const meta = await store.create({
          name: job.name,
          source: {
            kind: result.sourceMeta.kind,
            value: result.sourceMeta.value,
            commit: result.sourceMeta.commit,
          },
          localRootDir,
          graph: result.graph,
        });
        job.status = "done";
        job.projectId = meta.id;
        job.finishedAt = Date.now();
      } catch (e) {
        job.status = "error";
        job.error = (e as Error).message;
        job.finishedAt = Date.now();
      }
    })();

    res.status(202).json({ jobId });
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      res.json(await store.get(req.params.id));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  app.get("/api/projects/:id/graph", async (req, res) => {
    try {
      res.json(await store.getGraph(req.params.id));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      await store.delete(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const patch: Partial<ProjectMeta> = {};
      if (typeof req.body?.name === "string") patch.name = req.body.name.trim();
      if (req.body?.viewState && typeof req.body.viewState === "object") {
        patch.viewState = req.body.viewState as ProjectViewState;
      }
      if (typeof req.body?.localRootDir === "string" || req.body?.localRootDir === null) {
        patch.localRootDir = req.body.localRootDir;
      }
      const meta = await store.patchMeta(req.params.id, patch);
      res.json({ meta });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/projects/:id/reingest", async (req, res) => {
    try {
      const meta = await store.getMeta(req.params.id);
      const sourceArg =
        meta.source.kind === "path"
          ? meta.localRootDir || meta.source.value
          : meta.source.value;
      if (!sourceArg) {
        res.status(400).json({ error: "no local source available — project is portable/view-only" });
        return;
      }
      const result = await ingest({ source: sourceArg, workDir: store.workDir });
      await store.saveGraph(meta.id, result.graph);
      const localRootDir = result.sourceMeta.kind === "path" ? result.sourceMeta.value : result.rootDir;
      await store.patchMeta(meta.id, {
        localRootDir,
        source: {
          kind: result.sourceMeta.kind,
          value: result.sourceMeta.value,
          commit: result.sourceMeta.commit,
        },
      });
      res.json({ ok: true, stats: { nodes: result.graph.nodes.length, edges: result.graph.edges.length } });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ----- Export / import -----

  app.get("/api/projects/:id/export", async (req, res) => {
    try {
      const bundle = await store.exportBundle(req.params.id);
      const meta = await store.getMeta(req.params.id);
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${meta.name.replace(/[^a-z0-9_\-]/gi, "_")}.mcpviz"`
      );
      res.send(bundle);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/projects/import", async (req, res) => {
    try {
      const body = req.body;
      let raw: string;
      if (typeof body?.raw === "string") raw = body.raw;
      else if (typeof body?.filePath === "string") raw = await fs.readFile(body.filePath, "utf8");
      else {
        res.status(400).json({ error: "provide body.raw (string) or body.filePath" });
        return;
      }
      const meta = await store.importBundle(raw);
      res.json({ meta });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ----- Claude index-here (per project) -----

  app.post("/api/projects/:id/index-here", async (req, res) => {
    const folderRelPath: string | undefined = req.body?.folderPath;
    if (typeof folderRelPath !== "string") {
      res.status(400).json({ ok: false, error: "folderPath (string) required" });
      return;
    }

    let meta: ProjectMeta;
    try {
      meta = await store.getMeta(req.params.id);
    } catch {
      res.status(404).json({ ok: false, error: "project not found" });
      return;
    }
    if (!meta.localRootDir) {
      res.status(400).json({
        ok: false,
        error: "project has no local source on this machine — cannot index-here",
      });
      return;
    }
    const rootDir = meta.localRootDir;
    const folderAbsPath = path.resolve(rootDir, folderRelPath);
    if (!folderAbsPath.startsWith(path.resolve(rootDir))) {
      res.status(400).json({ ok: false, error: "folderPath escapes repo root" });
      return;
    }
    try {
      const stat = await fs.stat(folderAbsPath);
      if (!stat.isDirectory()) {
        res.status(400).json({ ok: false, error: "not a directory" });
        return;
      }
    } catch {
      res.status(404).json({ ok: false, error: `folder not found: ${folderAbsPath}` });
      return;
    }

    const csFiles = (await fg("*.cs", { cwd: folderAbsPath, dot: false })).map((f) =>
      folderRelPath ? `${folderRelPath}/${f}` : f
    );
    if (csFiles.length === 0) {
      res.status(400).json({
        ok: false,
        error: "no .cs files directly in this folder (try a leaf folder with scripts)",
      });
      return;
    }

    const prompt = buildIndexHerePrompt({ rootDir, folderRelPath, folderAbsPath, csFiles });
    console.log(`[mcpviz] index-here[${meta.id}]: ${folderRelPath} (${csFiles.length} .cs files)`);
    const result = await runClaudeOneshot(prompt, rootDir, {
      permissionMode: "acceptEdits",
      timeoutMs: 5 * 60 * 1000,
    });
    if (!result.ok || !result.text) {
      res.status(500).json({ ok: false, error: result.error ?? "no text", durationMs: result.durationMs });
      return;
    }
    const generated = result.text.trim();
    const claudeMdPath = path.join(folderAbsPath, "CLAUDE.md");
    try {
      await fs.writeFile(claudeMdPath, generated + "\n", "utf8");
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: `wrote by claude but failed to save: ${(e as Error).message}`,
      });
      return;
    }

    const graph: Graph = await store.getGraph(meta.id);
    const folderNodeId = `folder:${folderRelPath}`;
    const node: GraphNode | undefined = graph.nodes.find((n) => n.id === folderNodeId);
    const docBody = `# ${path.join(folderRelPath, "CLAUDE.md").replace(/\\/g, "/")}\n\n${generated}`;
    if (node) {
      node.docs = [...(node.docs ?? []).filter((d) => !d.includes("/CLAUDE.md")), docBody];
    }
    await store.saveGraph(meta.id, graph);

    console.log(
      `[mcpviz] index-here ok: ${folderRelPath} in ${(result.durationMs / 1000).toFixed(1)}s`
    );
    res.json({
      ok: true,
      folderPath: folderRelPath,
      durationMs: result.durationMs,
      numTurns: result.numTurns,
      generated,
    });
  });

  // ----- Static viz (Electron production) -----

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(opts.staticDir!, "index.html"));
    });
  }

  return new Promise((resolve) => {
    const server = app.listen(opts.port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : opts.port;
      const bin = findClaudeBinary();
      console.log(`[mcpviz] serve listening on http://localhost:${actualPort}`);
      console.log(`[mcpviz]   dataDir : ${opts.dataDir}`);
      console.log(`[mcpviz]   claude  : ${bin ?? "(NOT FOUND — index-here will fail)"}`);
      opts.onListening?.(actualPort);
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) =>
            server.close((err) => (err ? rejectClose(err) : resolveClose()))
          ),
      });
    });
  });
}
