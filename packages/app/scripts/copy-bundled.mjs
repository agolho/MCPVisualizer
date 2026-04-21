#!/usr/bin/env node
import { cp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const distDir = path.join(appRoot, "dist");

async function copy(fromRel, toRel) {
  const from = path.join(repoRoot, fromRel);
  const to = path.join(distDir, toRel);
  await rm(to, { recursive: true, force: true });
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`[copy-bundled] ${fromRel} -> dist/${toRel}`);
}

await copy("packages/ingester/dist", "ingester");
await copy("packages/viz/dist", "viz");
console.log("[copy-bundled] done");
