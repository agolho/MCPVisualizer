import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";

export interface WalkResult {
  csFiles: string[];   // repo-relative posix paths
  mdFiles: string[];   // repo-relative posix paths
}

const IGNORE = [
  "**/node_modules/**",
  "**/Library/**",     // Unity generated
  "**/Temp/**",
  "**/Build/**",
  "**/Builds/**",
  "**/Logs/**",
  "**/obj/**",
  "**/bin/**",
  "**/.git/**",
  "**/*.meta",
];

export async function walk(rootDir: string): Promise<WalkResult> {
  const [cs, md] = await Promise.all([
    fg("**/*.cs", { cwd: rootDir, ignore: IGNORE, dot: false }),
    fg(["**/CLAUDE.md", "**/*.md"], { cwd: rootDir, ignore: IGNORE, dot: false }),
  ]);
  return { csFiles: cs.sort(), mdFiles: md.sort() };
}

export async function readUtf8(rootDir: string, rel: string): Promise<string> {
  return fs.readFile(path.join(rootDir, rel), "utf8");
}

export function folderOf(relPosix: string): string {
  const i = relPosix.lastIndexOf("/");
  return i === -1 ? "" : relPosix.slice(0, i);
}

export function ancestors(folder: string): string[] {
  if (!folder) return [];
  const parts = folder.split("/");
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}
