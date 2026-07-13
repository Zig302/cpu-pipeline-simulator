import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "dev";
if (!new Set(["dev", "start"]).has(mode)) throw new Error("Usage: node scripts/qa-server.mjs dev|start");
const port = Number(process.env.QA_PORT ?? (mode === "dev" ? 4181 : 4182));
const manifest = JSON.parse(await readFile(resolve(root, "frontend/src/generated/wasm-manifest.json"), "utf8"));
const output = [];
const serverCommand = mode === "dev"
  ? { script: resolve(root, "node_modules/vinext/dist/cli.js"), args: ["dev", "--port", String(port)], cwd: root }
  : { script: resolve(root, "node_modules/wrangler/bin/wrangler.js"), args: ["dev", "--config", "wrangler.json", "--port", String(port), "--local"], cwd: resolve(root, "dist/server") };
const server = spawn(process.execPath, [serverCommand.script, ...serverCommand.args], {
  cwd: serverCommand.cwd,
  env: {
    ...process.env,
    NO_COLOR: "1",
    XDG_CONFIG_HOME: resolve(root, ".wrangler/xdg"),
    WRANGLER_LOG_PATH: resolve(root, ".wrangler/qa.log"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => output.push(chunk.toString()));

const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited early (${server.exitCode}).\n${output.join("")}`);
    try { const response = await fetch(base); if (response.ok) return response; } catch {}
    await sleep(200);
  }
  throw new Error(`Server did not become ready.\n${output.join("")}`);
}
async function expectAsset(path, contentType) {
  const response = await fetch(`${base}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const actual = response.headers.get("content-type") ?? "";
  if (!actual.includes(contentType)) throw new Error(`${path} returned ${actual}, expected ${contentType}`);
  await response.arrayBuffer();
}
async function runPublisher() {
  // Reconstruct the raw Emscripten pair from the immutable published artifact.
  // This keeps server QA independent of ignored build directories, which may
  // belong to another Windows account in sandboxed or CI environments.
  const temporary = await mkdtemp(join(tmpdir(), "cpulab-wasm-qa-"));
  try {
    const generated = resolve(root, "frontend/src/generated");
    const [publishedJavaScript, wasm] = await Promise.all([
      readFile(resolve(generated, manifest.js), "utf8"),
      readFile(resolve(generated, manifest.wasm)),
    ]);
    const rawJavaScript = publishedJavaScript.replaceAll(`'${manifest.wasm}'`, "'cpu_core.wasm'");
    if (rawJavaScript === publishedJavaScript) throw new Error("Published WASM loader did not reference its fingerprinted binary.");
    const sourceJs = resolve(temporary, "cpu_core.js");
    const sourceWasm = resolve(temporary, "cpu_core.wasm");
    await Promise.all([writeFile(sourceJs, rawJavaScript), writeFile(sourceWasm, wasm)]);
    await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [resolve(root, "scripts/publish-wasm.mjs"), sourceJs, sourceWasm], { cwd: root, stdio: "pipe" });
      let diagnostics = "";
      child.stdout.on("data", (chunk) => diagnostics += chunk);
      child.stderr.on("data", (chunk) => diagnostics += chunk);
      child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(diagnostics)));
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function stopServer() {
  if (server.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
      killer.once("exit", resolvePromise);
      killer.once("error", resolvePromise);
    });
    server.stdout.destroy();
    server.stderr.destroy();
    server.unref();
    return;
  }
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolvePromise) => server.once("exit", resolvePromise)), sleep(2_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

try {
  const rootResponse = await waitForServer();
  const html = await rootResponse.text();
  if (!html.includes("Pipeline Lab")) throw new Error("Application title is missing from rendered HTML.");
  if (mode === "dev") {
    await expectAsset("/frontend/src/CpuLab.tsx", "text/javascript");
    await expectAsset("/frontend/src/wasm.ts", "text/javascript");
    await expectAsset("/frontend/src/generated/wasm-artifact.ts", "text/javascript");
    await expectAsset(`/frontend/src/generated/${manifest.js}`, "text/javascript");
    await expectAsset(`/frontend/src/generated/${manifest.wasm}`, "application/wasm");
    await runPublisher();
    await expectAsset(`/frontend/src/generated/${manifest.js}`, "text/javascript");
    await expectAsset(`/frontend/src/generated/${manifest.wasm}`, "application/wasm");
  } else {
    const assets = await readdir(resolve(root, "dist/client/assets"));
    const wasm = assets.find((name) => name.endsWith(".wasm"));
    if (!wasm) throw new Error("Production build did not emit a fingerprinted WASM asset.");
    await expectAsset(`/assets/${wasm}`, "application/wasm");
  }
  await sleep(300);
  const logs = output.join("");
  if (/EPERM|socket-error-backstop|Failed to load|Unhandled|uncaught/i.test(logs)) throw new Error(`Server diagnostics contain a fatal error.\n${logs}`);
  console.log(`${mode} server QA passed on ${base} for WASM build ${manifest.build}`);
} finally {
  await stopServer();
}
