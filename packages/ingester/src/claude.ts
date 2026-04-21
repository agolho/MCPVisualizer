import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface ClaudeResult {
  ok: boolean;
  text?: string;
  error?: string;
  durationMs: number;
  numTurns?: number;
}

/**
 * Find the claude executable on disk. On Windows npm-installed binaries often aren't
 * on the PATH inherited by child processes; we probe common install locations as a
 * fallback. Returns an absolute path (.cmd / .exe / .ps1) or null if nothing found.
 */
let cachedClaudeBin: string | null | undefined;
export function findClaudeBinary(): string | null {
  if (cachedClaudeBin !== undefined) return cachedClaudeBin;

  // 1. Ask the shell via `where` / `which`.
  const lookup = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(lookup, ["claude"], { shell: true, encoding: "utf8" });
  if (r.status === 0 && r.stdout) {
    const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    // Prefer .cmd on Windows so `spawn` + shell works cleanly.
    const preferred =
      lines.find((l) => l.toLowerCase().endsWith(".cmd")) ??
      lines.find((l) => l.toLowerCase().endsWith(".exe")) ??
      lines[0];
    if (preferred && fs.existsSync(preferred)) {
      cachedClaudeBin = preferred;
      return preferred;
    }
  }

  // 2. Known Windows install locations.
  if (process.platform === "win32") {
    const candidates: string[] = [];
    const appdata = process.env.APPDATA;
    const localappdata = process.env.LOCALAPPDATA;
    const home = process.env.USERPROFILE;
    if (appdata) {
      candidates.push(path.join(appdata, "npm", "claude.cmd"));
      candidates.push(path.join(appdata, "npm", "claude.ps1"));
    }
    if (home) {
      candidates.push(path.join(home, ".claude", "local", "claude.exe"));
      candidates.push(path.join(home, ".claude", "local", "node_modules", ".bin", "claude.cmd"));
    }
    if (localappdata) {
      candidates.push(path.join(localappdata, "Programs", "claude-code", "claude.exe"));
      candidates.push(path.join(localappdata, "AnthropicClaude", "claude.exe"));
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        cachedClaudeBin = c;
        return c;
      }
    }
  } else {
    // POSIX fallbacks
    const home = process.env.HOME;
    const candidates = [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      home ? path.join(home, ".claude", "local", "claude") : null,
      home ? path.join(home, ".local", "bin", "claude") : null,
    ].filter((x): x is string => !!x);
    for (const c of candidates) if (fs.existsSync(c)) {
      cachedClaudeBin = c;
      return c;
    }
  }

  cachedClaudeBin = null;
  return null;
}

export async function runClaudeOneshot(
  prompt: string,
  cwd: string,
  opts: { permissionMode?: "default" | "acceptEdits" | "bypassPermissions"; timeoutMs?: number } = {}
): Promise<ClaudeResult> {
  const started = Date.now();
  const bin = findClaudeBinary();
  if (!bin) {
    return {
      ok: false,
      error:
        "could not find `claude` on PATH or in known install locations. " +
        "Install Claude Code (npm i -g @anthropic-ai/claude-code) or start the server from a shell where `claude --version` works.",
      durationMs: Date.now() - started,
    };
  }

  const permissionMode = opts.permissionMode ?? "acceptEdits";
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  // Stash the prompt in a temp file and feed it via shell-level stdin redirection.
  // Avoids the STATUS_DLL_INIT_FAILED (0xC0000142) class of errors we see when piping
  // stdin directly into the pkg-bundled claude.exe from Node on Windows.
  const tmpPrompt = path.join(
    os.tmpdir(),
    `mcpviz-prompt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`
  );
  await fsp.writeFile(tmpPrompt, prompt, "utf8");

  const cleanup = () => {
    fsp.unlink(tmpPrompt).catch(() => {});
  };

  return new Promise<ClaudeResult>((resolve) => {
    const isWin = process.platform === "win32";
    let cmd: string;
    if (isWin) {
      // cmd.exe /s /c "<full quoted command> < <promptFile>"
      cmd = `"${bin}" -p --output-format json --permission-mode ${permissionMode} < "${tmpPrompt}"`;
    } else {
      cmd = `"${bin}" -p --output-format json --permission-mode ${permissionMode} < "${tmpPrompt}"`;
    }

    // Strip npm- and Node-injected env vars before spawning. The pkg-bundled
    // claude.exe ships its own Node runtime; inherited NODE_OPTIONS or
    // npm_* variables from `npm run serve` can trip its DLL init and produce
    // exit 0xC0000142 (STATUS_DLL_INIT_FAILED) on Windows.
    const cleanEnv: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith("npm_")) continue;
      if (k === "NODE_OPTIONS") continue;
      if (k === "NODE_PATH") continue;
      if (k === "NODE_NO_WARNINGS") continue;
      if (k === "NODE_ENV") continue; // claude.exe is pkg-bundled; its Node shouldn't see ours
      cleanEnv[k] = v;
    }

    let child;
    try {
      child = spawn(cmd, [], {
        cwd,
        shell: true,
        windowsHide: true,
        env: cleanEnv,
      });
    } catch (e) {
      cleanup();
      resolve({
        ok: false,
        error: `could not spawn ${bin}: ${(e as Error).message}`,
        durationMs: Date.now() - started,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => child.kill(), timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timeout);
      cleanup();
      resolve({
        ok: false,
        error: `spawn error for ${bin}: ${e.message}`,
        durationMs: Date.now() - started,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      cleanup();
      if (code !== 0) {
        resolve({
          ok: false,
          error: `claude exited ${code}: ${stderr.slice(0, 800) || stdout.slice(0, 800)}`,
          durationMs: Date.now() - started,
        });
        return;
      }
      try {
        const j = JSON.parse(stdout);
        if (j.is_error) {
          resolve({
            ok: false,
            error: j.result ?? "claude returned is_error=true",
            durationMs: Date.now() - started,
            numTurns: j.num_turns,
          });
        } else {
          resolve({
            ok: true,
            text: typeof j.result === "string" ? j.result : "",
            durationMs: Date.now() - started,
            numTurns: j.num_turns,
          });
        }
      } catch (e) {
        resolve({
          ok: false,
          error: `could not parse claude JSON: ${(e as Error).message}\nstdout head: ${stdout.slice(0, 500)}`,
          durationMs: Date.now() - started,
        });
      }
    });
  });
}

export function buildIndexHerePrompt(args: {
  rootDir: string;
  folderRelPath: string;
  folderAbsPath: string;
  csFiles: string[];
}): string {
  const folderName = args.folderRelPath.split(/[\\/]/).pop() || args.folderRelPath || "root";
  const fileList = args.csFiles.slice(0, 40).map((f) => `- ${f}`).join("\n");
  const truncated =
    args.csFiles.length > 40 ? `\n(…and ${args.csFiles.length - 40} more .cs files in this folder)` : "";

  return `You are generating a CLAUDE.md architecture index for a single folder in a Unity C# project.

Folder (repo-relative): ${args.folderRelPath || "(repo root)"}
Absolute path: ${args.folderAbsPath}

C# files in this folder:
${fileList}${truncated}

Use the Read / Glob / Grep tools to explore the .cs files listed above (or a representative sample if there are many). Do NOT use Write / Edit / Bash — you are read-only.

When you understand the folder, respond with ONLY the markdown content of the CLAUDE.md — no preamble, no trailing commentary, no \`\`\`markdown fences. The caller will take your entire response and write it to disk verbatim.

Target shape (keep it tight — aim for 25-60 lines):

# ${folderName} — Architecture Index

One paragraph: the role this folder plays in the Unity project. What subsystem, what responsibility.

## Key scripts

- **ClassName** — one-line description of its responsibility.
- **AnotherClass** — …

(List the 5-12 most important classes; skip trivial enums/DTOs unless essential.)

## Connections

Cross-folder references you noticed — look at \`using\` directives at the top of files and explicit type names referenced in the code. Format as bullets:
- \`OtherNamespace.OtherClass\` — what we use it for / where we reference it.

## Notable patterns

- Is this folder mostly MonoBehaviours, ScriptableObjects, Editor scripts, plain classes, static utilities?
- Any event-bus, singleton, or DI pattern that jumps out?

Begin your response immediately with the \`#\` heading. No preamble.
`;
}
