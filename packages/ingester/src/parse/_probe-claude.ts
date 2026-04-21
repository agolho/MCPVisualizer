// Heavy probe: tries `claude -p` with a trivial prompt via our actual spawn
// pattern (stdin redirected from a temp file through cmd.exe). If this fails
// with 0xC0000142 but the same claude.exe runs fine from the user's shell,
// the Bash-tool sandbox is the culprit.
import { spawn } from "node:child_process";
import { findClaudeBinary } from "../claude.js";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const bin = findClaudeBinary();
if (!bin) {
  console.error("no claude binary found");
  process.exit(1);
}
console.log("claude at:", bin);

const tmp = path.join(os.tmpdir(), `mcpviz-probe-${Date.now()}.txt`);
await fsp.writeFile(tmp, "Respond with just the word 'pong'.", "utf8");

const cmd = `"${bin}" -p --output-format json --permission-mode acceptEdits < "${tmp}"`;
console.log("cmd:", cmd);

const started = Date.now();
const child = spawn(cmd, [], { shell: true, windowsHide: true });
let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.stderr.on("data", (d) => (err += d.toString()));
child.on("close", (code) => {
  console.log("exit:", code, `in ${Date.now() - started}ms`);
  console.log("stdout head:", out.slice(0, 400));
  if (err) console.log("stderr head:", err.slice(0, 400));
  fsp.unlink(tmp).catch(() => {});
});
