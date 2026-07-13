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
  assert.equal(js.includes(13), false, "generated JavaScript must use checkout-stable LF line endings");
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
  assert.match(runner, /Date\.now\(\) \+ 60_000/);
  assert.match(runner, /finally \{\s*await stopServer\(\);\s*\}/);
  assert.match(runner, /mkdtemp\(join\(tmpdir\(\), "cpulab-wasm-qa-"\)\)/);
  assert.doesNotMatch(runner, /out[\\/]wasm/);
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

test("project persistence and trace export are versioned and validated", async () => {
  const [project, component, pkg] = await Promise.all([
    readFile(new URL("frontend/src/project.ts", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.equal(JSON.parse(pkg).version, "1.3.0");
  assert.match(project, /format: "pipeline-lab-project"/);
  assert.match(project, /Unsupported Pipeline Lab project format/);
  assert.match(project, /format: "pipeline-lab-trace"/);
  assert.match(component, /Download project/);
  assert.match(component, /Restore browser draft/);
  assert.match(component, /Export execution trace/);
});

test("learning center includes guided labs, ISA help, and core-backed performance analysis", async () => {
  const [learning, center, component, bindings] = await Promise.all([
    readFile(new URL("frontend/src/learning.ts", root), "utf8"),
    readFile(new URL("frontend/src/LearningCenter.tsx", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("core/src/bindings.cpp", root), "utf8"),
  ]);
  for (const id of ["pipeline-basics", "load-use", "branch-recovery", "manual-correctness"]) assert.match(learning, new RegExp(`id: "${id}"`));
  for (const mnemonic of ["ADD", "LW", "BEQ / BNE / BLT", "JAL", "NOP / HALT"]) assert.match(learning, new RegExp(`mnemonic: "${mnemonic.replaceAll("/", "\\/")}"`));
  assert.match(center, /Performance Lab/);
  assert.match(center, /Run benchmark/);
  assert.match(component, /createSimulator\(\)/);
  assert.match(component, /Reference mismatch found/);
  assert.match(bindings, /compareReference/);
});

test("performance reports cover release and custom configurations and remain exportable", async () => {
  const [benchmark, center, component, project] = await Promise.all([
    readFile(new URL("frontend/src/benchmark.ts", root), "utf8"),
    readFile(new URL("frontend/src/LearningCenter.tsx", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/project.ts", root), "utf8"),
  ]);
  for (const kind of ["suite", "forwarding", "prediction", "cache", "custom"]) assert.match(benchmark, new RegExp(`"${kind}"`));
  for (const scenario of ["baseline", "no-forwarding", "always-not-taken", "cache-enabled"]) assert.match(benchmark, new RegExp(`"${scenario}"`));
  assert.match(benchmark, /format: "pipeline-lab-benchmark"/);
  assert.match(benchmark, /architecturalMatch/);
  assert.match(benchmark, /benchmarkCsv/);
  assert.match(component, /benchmarkScenarios/);
  assert.match(component, /compareReference\(\)/);
  assert.match(center, /Cycle comparison chart/);
  assert.match(center, /Export JSON/);
  assert.match(center, /Export CSV/);
  assert.match(project, /export function downloadText/);
});

test("v1.3 microarchitecture settings are core-validated, preset-backed, and persisted", async () => {
  const [configuration, component, types, bindings, core, project, benchmark] = await Promise.all([
    readFile(new URL("frontend/src/configuration.ts", root), "utf8"),
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/types.ts", root), "utf8"),
    readFile(new URL("core/src/bindings.cpp", root), "utf8"),
    readFile(new URL("core/src/core.cpp", root), "utf8"),
    readFile(new URL("frontend/src/project.ts", root), "utf8"),
    readFile(new URL("frontend/src/benchmark.ts", root), "utf8"),
  ]);
  for (const field of ["predictorEntries", "cacheCapacity", "cacheBlockSize", "cacheAssociativity", "cacheHitLatency", "cacheMissPenalty"]) {
    assert.match(configuration, new RegExp(field));
    assert.match(component, new RegExp(field));
    assert.match(core, new RegExp(field));
  }
  for (const preset of ["balanced", "tiny-direct", "spatial", "branch-pressure", "slow-memory"]) assert.match(configuration, new RegExp(`id: "${preset}"`));
  assert.match(configuration, /CUSTOM_PRESET_STORAGE_KEY/);
  assert.match(component, /validateConfigurationJson/);
  assert.match(component, /applyConfigurationJson/);
  assert.match(bindings, /validateConfigurationJson/);
  assert.match(bindings, /applyConfigurationJson/);
  assert.match(types, /configuration: ProcessorConfiguration/);
  assert.match(project, /version: 2/);
  assert.match(project, /\[1, 2\]/);
  assert.match(benchmark, /kind === "custom"/);
  assert.match(benchmark, /predictor_entries/);
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

test("stage explanations follow live cycle state and expose real register reads", async () => {
  const [component, types, core] = await Promise.all([
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/types.ts", root), "utf8"),
    readFile(new URL("core/src/core.cpp", root), "utf8"),
  ]);
  assert.match(component, /selectedStage\?slots\.find/);
  assert.match(component, /setSelectedStage\(name\)/);
  assert.match(component, /The register file reads/);
  assert.match(component, /Latched register values/);
  assert.match(component, /No data-memory access is required/);
  assert.match(component, /register file commits it on the next cycle step/);
  for (const field of ["usesRs1", "usesRs2", "rs1Value", "rs2Value"]) {
    assert.match(types, new RegExp(`${field}:`));
    assert.match(core, new RegExp(`\\\\\"${field}\\\\\"`));
  }
});

test("v1.3 QA hardening keeps cache state bounded, benchmarks sequential, and initialized inputs authoritative", async () => {
  const [component, types, core, center, styles] = await Promise.all([
    readFile(new URL("frontend/src/CpuLab.tsx", root), "utf8"),
    readFile(new URL("frontend/src/types.ts", root), "utf8"),
    readFile(new URL("core/src/core.cpp", root), "utf8"),
    readFile(new URL("frontend/src/LearningCenter.tsx", root), "utf8"),
    readFile(new URL("frontend/src/lab.css", root), "utf8"),
  ]);
  assert.doesNotMatch(component, /Promise\.all\(benchmarkScenarios/);
  assert.match(component, /for\(const scenario of benchmarkScenarios/);
  assert.match(component, /getInitialState\(\)/);
  assert.match(component, /initial\.memory\.slice/);
  assert.match(component, /Ignored .* invalid saved preset/);
  assert.match(types, /memoryDifferences: ReferenceMemoryDifference\[\]/);
  for (const field of ["predictedTarget", "actualTarget", "totalSets", "visibleSetIndices", "stallCycles"]) assert.match(types, new RegExp(field));
  assert.match(core, /coherentMemory\(\)/);
  assert.match(core, /visibleCount=std::min/);
  assert.match(core, /runWithInitialState/);
  assert.match(center, /benchmark-error/);
  assert.match(styles, /\.switch input:focus-visible\+i/);
  assert.match(styles, /\.cache-preview-note/);
});
