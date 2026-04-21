import { parseCsFile } from "./csharp.js";
import fs from "node:fs/promises";

const file =
  process.argv[2] ??
  "C:/Users/agolh/Documents/GitHub/LuckyCarnival/Assets/Scripts/CustomInput/MultiTouchManager.cs";

const src = await fs.readFile(file, "utf8");
const parsed = await parseCsFile(src);
console.log("loc:", parsed.loc);
for (const t of parsed.types) {
  console.log(`- ${t.kind} ${t.fullName}  bases=[${t.bases.join(", ")}]  methods=${t.methods.length}  serializedFields=${t.serializedFields.length}  componentRefs=${t.componentRefs.length}`);
  for (const sf of t.serializedFields.slice(0, 10)) {
    console.log(`    [SF] ${sf.name}: ${sf.rawType}  (candidates=${sf.candidates.join(",")})`);
  }
  for (const cr of t.componentRefs.slice(0, 10)) {
    console.log(`    [CR] ${cr.method}<${cr.typeName}>  (candidates=${cr.candidates.join(",")})  @L${cr.line}`);
  }
}
