import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function renderApplication() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("production application opens and serves its client entry", async () => {
  const response = await renderApplication();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  const html = await response.text();
  assert.match(html, /Pipeline Lab/);
  assert.match(html, /og\.png/);
  assert.match(html, /<script[^>]*>import\("\/assets\//);
});

test("the production shell names the simulator and omits starter metadata", async () => {
  const [layout, page, component] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
  ]);
  assert.match(layout, /Pipeline Lab/);
  assert.doesNotMatch(layout + page, /codex-preview|SkeletonPreview|Starter Project/);
  assert.match(component, /Six-stage pipeline/);
  assert.match(component, /Pipeline timeline/);
  assert.match(component, /Explanation/);
  assert.match(component, /runUntilBreakpoint/);
  assert.match(component, /restorePreviousCycle/);
});

test("Vite owns the referenced immutable, content-verified WASM artifact", async () => {
  const [adapter, manifestText, artifact] = await Promise.all([
    readFile(new URL("frontend/src/wasm.ts", root), "utf8"),
    readFile(new URL("frontend/src/generated/wasm-manifest.json", root), "utf8"),
    readFile(new URL("frontend/src/generated/wasm-artifact.ts", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const [js, wasm] = await Promise.all([
    readFile(new URL(`frontend/src/generated/${manifest.js}`, root)),
    readFile(new URL(`frontend/src/generated/${manifest.wasm}`, root)),
  ]);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(js), manifest.jsSha256);
  assert.equal(hash(wasm), manifest.wasmSha256);
  await WebAssembly.compile(wasm);
  assert.match(adapter, /from "\.\/generated\/wasm-artifact"/);
  assert.match(artifact, new RegExp(manifest.js.replaceAll(".", "\\.")));
  assert.match(artifact, new RegExp(`${manifest.wasm.replaceAll(".", "\\.")}\\?url`));
  await assert.rejects(readFile(new URL("public/wasm/cpu_core.js", root)), { code: "ENOENT" });
});

test("server QA tears down the full Windows worker process tree", async () => {
  const runner = await readFile(new URL("scripts/qa-server.mjs", root), "utf8");
  assert.match(runner, /process\.platform === "win32"/);
  assert.match(runner, /spawn\("taskkill", \["\/pid", String\(server\.pid\), "\/t", "\/f"\]/);
  assert.match(runner, /finally \{\s*await stopServer\(\);\s*\}/);
});

test("WebAssembly uses fixed memory for TextDecoder browser compatibility", async () => {
  const cmake = await readFile(new URL("CMakeLists.txt", root), "utf8");
  assert.match(cmake, /-sALLOW_MEMORY_GROWTH=0/);
  assert.match(cmake, /-sINITIAL_MEMORY=134217728/);
});

test("all required pipeline stages and educational examples are present", async () => {
  const [component, examples] = await Promise.all([
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/examples.ts", root), "utf8"),
  ]);
  for (const stage of ["IF", "ID", "EX", "MEM1", "MEM2", "WB"]) assert.match(component, new RegExp(`\\"${stage}\\"`));
  for (const id of ["arithmetic", "raw-none", "forwarding", "load-use", "store-forward", "branches", "mispredict", "loop", "sum", "cache-seq", "cache-stride", "manual"]) assert.match(examples, new RegExp(`id: \\"${id}\\"`));
});

test("example selection cannot diverge from the program loaded in the CPU", async () => {
  const component = await readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8");
  assert.match(component, /setExampleId\(x\.id\);assembleSource\(x\.source\)/);
  assert.match(component, /setSourceDirty\(true\);setRunning\(false\)/);
  assert.match(component, /const executionDisabled=sourceDirty\|\|!assembly\.ok/);
  assert.match(component, /disabled=\{executionDisabled\}/);
  assert.match(component, /index<assembly\.words\.length/);
});

test("the interface provides a readable guide and organized state workspace", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/lab.css", root), "utf8"),
  ]);
  assert.match(component, /How to use Pipeline Lab/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /State inspectors/);
  assert.match(styles, /\.guide-grid\{display:grid/);
  assert.match(styles, /\.datapath-canvas\{height:278px;display:grid/);
  assert.match(component, /type Density = "comfortable" \| "compact"/);
  assert.match(component, /aria-label="Interface density"/);
  assert.match(styles, /\.density-comfortable \.stage-name\{font-size:17px\}/);
  assert.match(styles, /Compact preserves the prior view/);
});

test("v1.1 project persistence and trace export are versioned and validated", async () => {
  const [project, component, pkg] = await Promise.all([
    readFile(new URL("frontend/src/project.ts", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.equal(JSON.parse(pkg).version, "1.1.0");
  assert.match(project, /format: "pipeline-lab-project"/);
  assert.match(project, /Unsupported Pipeline Lab project format/);
  assert.match(project, /format: "pipeline-lab-trace"/);
  assert.match(component, /Download project/);
  assert.match(component, /Restore browser draft/);
  assert.match(component, /Export execution trace/);
});

test("v1.1 learning center includes guided labs, ISA help, and core-backed comparison", async () => {
  const [learning, center, component, bindings] = await Promise.all([
    readFile(new URL("frontend/src/learning.ts", root), "utf8"),
    readFile(new URL("frontend/src/LearningCenter.tsx", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("core/src/bindings.cpp", root), "utf8"),
  ]);
  for (const id of ["pipeline-basics", "load-use", "branch-recovery", "manual-correctness"]) assert.match(learning, new RegExp(`id: "${id}"`));
  for (const mnemonic of ["ADD", "LW", "BEQ / BNE / BLT", "JAL", "NOP / HALT"]) assert.match(learning, new RegExp(`mnemonic: "${mnemonic.replaceAll("/", "\\/")}"`));
  assert.match(center, /Run comparison/);
  assert.match(component, /createSimulator\(\)/);
  assert.match(component, /Reference mismatch found/);
  assert.match(bindings, /compareReference/);
});

test("keyboard and accessibility landmarks are present", async () => {
  const [component, center, styles] = await Promise.all([
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/LearningCenter.tsx", root), "utf8"),
    readFile(new URL("frontend/src/lab.css", root), "utf8"),
  ]);
  assert.match(component, /Skip to simulator workspace/);
  assert.match(component, /event\.key==="F10"/);
  assert.match(component, /event\.key\.toLowerCase\(\)==="s"/);
  assert.match(component, /role="tabpanel"/);
  assert.match(center, /aria-current=\{current \? "step"/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /:focus-visible/);
});
