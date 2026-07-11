import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = resolve(root, "frontend/src/generated");
const manifestPath = resolve(generated, "wasm-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const paths = {
  js: resolve(generated, manifest.js),
  wasm: resolve(generated, manifest.wasm),
  artifact: resolve(generated, "wasm-artifact.ts"),
};
await Promise.all(Object.values(paths).map((path) => access(path)));
const [js, wasm, artifact] = await Promise.all([
  readFile(paths.js), readFile(paths.wasm), readFile(paths.artifact, "utf8"),
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (hash(js) !== manifest.jsSha256) throw new Error("Generated Emscripten JavaScript hash mismatch.");
if (hash(wasm) !== manifest.wasmSha256) throw new Error("Generated WebAssembly hash mismatch.");
if (!artifact.includes(manifest.build) || !artifact.includes(manifest.js) || !artifact.includes(manifest.wasm)) {
  throw new Error("Generated WASM TypeScript manifest is out of sync.");
}
await WebAssembly.compile(wasm);
console.log(`Verified WASM build ${manifest.build}`);
