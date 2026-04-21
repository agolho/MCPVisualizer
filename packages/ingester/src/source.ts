import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { simpleGit } from "simple-git";
import type { GraphMeta } from "@mcpviz/shared";

export interface ResolvedSource {
  rootDir: string;
  meta: GraphMeta["source"];
}

const GIT_URL = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/).+\.git(\/?$|#.+$)?|^[^/\s]+\/[^/\s]+$/i;

function looksLikeGitUrl(input: string): boolean {
  if (/^[a-z]:[\\/]/i.test(input)) return false; // Windows drive letter
  return GIT_URL.test(input) || input.endsWith(".git");
}

export async function resolveSource(input: string, workDir: string): Promise<ResolvedSource> {
  if (looksLikeGitUrl(input)) {
    await fs.mkdir(workDir, { recursive: true });
    const hash = crypto.createHash("sha1").update(input).digest("hex").slice(0, 10);
    const dest = path.join(workDir, `repo-${hash}`);
    const git = simpleGit();
    try {
      await fs.access(dest);
      await simpleGit(dest).fetch();
    } catch {
      console.log(`[mcpviz] cloning ${input} -> ${dest}`);
      await git.clone(input, dest, ["--depth=1"]);
    }
    const commit = await simpleGit(dest).revparse(["HEAD"]).catch(() => undefined);
    return {
      rootDir: dest,
      meta: { kind: "git", value: input, commit: commit?.trim() },
    };
  }

  const abs = path.resolve(input);
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) throw new Error(`Source is not a directory: ${abs}`);
  return { rootDir: abs, meta: { kind: "path", value: abs } };
}
