import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const manifest = JSON.parse(readFileSync(new URL("../source-manifest.json", import.meta.url), "utf8"));
for (const file of manifest.files) {
  const bytes = readFileSync(new URL(`../vendor/threeui/${file.path}`, import.meta.url));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== (file.customizedSha256 ?? file.sha256)) throw new Error(`Checksum mismatch: ${file.path}`);
  console.log(`Verified ${file.path}${file.customizedSha256 ? " (customized text)" : " (original)"}`);
}
