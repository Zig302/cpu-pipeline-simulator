import { expect, test, type Download, type Page } from "@playwright/test";

const EXAMPLES = ["arithmetic", "raw-none", "forwarding", "load-use", "store-forward", "branches", "mispredict", "loop", "sum", "cache-seq", "cache-stride", "manual"];

async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "PIPELINE LAB" })).toBeVisible();
  await expect(page.getByRole("button", { name: "IF pipeline stage" })).toBeVisible();
  await expect(page.locator(".boot-error")).toHaveCount(0);
}

function watchRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function loadExample(page: Page, id: string) {
  await page.locator(".example-picker select").selectOption(id);
  await expect(page.locator(".editor-state")).toHaveText("Loaded in CPU");
  await expect(page.locator(".status-pill")).toContainText("ready");
}

async function openMore(page: Page) {
  const details = page.locator(".more-controls");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details.locator(":scope > div")).toBeVisible();
}

async function moreAction(page: Page, label: string) {
  await openMore(page);
  await page.locator(".more-controls button").filter({ hasText: label }).click();
}

async function runToCompletion(page: Page) {
  await moreAction(page, "Run to completion");
  await expect(page.locator(".status-pill")).toContainText(/halted|completed|fault/);
}

async function openConfiguration(page: Page) {
  const details = page.locator(".configuration");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details.locator(".configuration-body")).toBeVisible();
}

async function applyConfiguration(page: Page, options: { forwarding?: string; predictor?: string; predictorEntries?: number; cache?: boolean; cacheCapacity?: number; cacheBlockSize?: number; cacheAssociativity?: number; cacheHitLatency?: number; cacheMissPenalty?: number }) {
  await openConfiguration(page);
  if (options.forwarding) await page.getByLabel("Hazard handling").selectOption(options.forwarding);
  if (options.predictor) await page.getByLabel("Branch predictor").selectOption(options.predictor);
  if (options.predictorEntries !== undefined) await page.getByLabel("Predictor entries").fill(String(options.predictorEntries));
  if (options.cache !== undefined) {
    const cache=page.locator(".configuration input[type=checkbox]");
    if ((await cache.isChecked())!==options.cache)await page.locator(".configuration .switch").click();
    await expect(cache).toBeChecked({ checked: options.cache });
  }
  if (options.cacheCapacity !== undefined) await page.getByLabel("Capacity (bytes)").fill(String(options.cacheCapacity));
  if (options.cacheBlockSize !== undefined) await page.getByLabel("Block size (bytes)").fill(String(options.cacheBlockSize));
  if (options.cacheAssociativity !== undefined) await page.getByLabel("Associativity (ways)").fill(String(options.cacheAssociativity));
  if (options.cacheHitLatency !== undefined) await page.getByLabel("Hit latency").fill(String(options.cacheHitLatency));
  if (options.cacheMissPenalty !== undefined) await page.getByLabel("Miss penalty").fill(String(options.cacheMissPenalty));
  await page.getByRole("button", { name: "Apply & reset processor" }).click();
  await expect(page.locator(".status-pill")).toContainText("ready");
}

async function selectInspector(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

async function statistic(page: Page, name: string) {
  await selectInspector(page, "Statistics");
  return page.locator(".stats-list > div").filter({ hasText: name }).locator("b");
}

async function setMemoryWord(page: Page, address: number, value: number) {
  await selectInspector(page, "Memory");
  await page.getByLabel("Address").fill(`0x${address.toString(16)}`);
  await page.getByLabel("Word value").fill(String(value));
  await page.getByRole("button", { name: "Write word" }).click();
  const bytes = [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255].map(byte => byte.toString(16).padStart(2, "0"));
  await expect(page.locator(".hex-dump span").filter({ hasText: bytes[0] }).first()).toBeVisible();
}

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("workbench controls, dialogs, responsive density, and continuous execution", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);
  await expect(page.locator(".stage-card")).toHaveCount(6);
  await expect(page.getByRole("tab")).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Pipeline timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active datapath" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explanation" })).toBeVisible();

  await page.getByRole("button", { name: "Guide" }).click();
  await expect(page.getByRole("dialog", { name: "How to use Pipeline Lab" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "How to use Pipeline Lab" })).toHaveCount(0);

  await openMore(page);
  await page.getByLabel("Interface density").selectOption("compact");
  await expect(page.locator("main.lab")).toHaveClass(/density-compact/);
  await page.getByLabel("Interface density").selectOption("comfortable");
  await expect(page.locator("main.lab")).toHaveClass(/density-comfortable/);
  await page.locator(".more-controls summary").click();

  await page.getByRole("button", { name: "Step cycle" }).click();
  await expect(page.locator(".run-status .metric").filter({ hasText: "Cycle" }).locator("strong")).toHaveText("1");
  await page.getByRole("button", { name: "Step instruction" }).click();
  await expect(page.locator(".run-status .metric").filter({ hasText: "Retired" }).locator("strong")).toHaveText("1");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Run" }).click();
  await expect.poll(async () => Number(await page.locator(".run-status .metric").filter({ hasText: "Cycle" }).locator("strong").innerText())).toBeGreaterThan(0);
  const pause = page.getByRole("button", { name: "Pause" });
  if (await pause.isVisible()) await pause.click();
  await expect(errors).toEqual([]);
});

test("Array summation single-step and undo replay keep explanations and state synchronized", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);
  await loadExample(page, "sum");
  for (let index = 0; index < 5; index++) await setMemoryWord(page, 0x400 + index * 4, index + 1);
  await selectInspector(page, "Registers");

  await page.getByRole("button", { name: "Step cycle" }).click();
  await page.getByRole("button", { name: "ID pipeline stage" }).click();
  await expect(page.locator(".explanation > p")).toContainText("instruction #1");
  await page.getByRole("button", { name: "Step cycle" }).click();
  await expect(page.locator(".explanation > p")).toContainText("instruction #2");
  await expect(page.locator(".explanation > p")).not.toContainText("instruction #1:");

  let sawPointerRead = false;
  for (let index = 0; index < 10; index++) {
    await page.getByRole("button", { name: "Step cycle" }).click();
    const explanation = await page.locator(".explanation > p").innerText();
    if (explanation.includes("r1 = 0x00000400")) { sawPointerRead = true; break; }
  }
  expect(sawPointerRead).toBe(true);
  const cycleBeforeUndo = Number(await page.locator(".run-status .metric").filter({ hasText: "Cycle" }).locator("strong").innerText());
  const explanationBeforeUndo = await page.locator(".explanation > p").innerText();
  await moreAction(page, "Undo cycle");
  await expect(page.locator(".run-status .metric").filter({ hasText: "Cycle" }).locator("strong")).toHaveText(String(cycleBeforeUndo - 1));
  await page.getByRole("button", { name: "Step cycle" }).click();
  await expect(page.locator(".explanation > p")).toHaveText(explanationBeforeUndo);

  await runToCompletion(page);
  await selectInspector(page, "Registers");
  await expect(page.locator(".register-grid button").filter({ has: page.locator("span", { hasText: /^r3$/ }) })).toContainText("15");
  await expect(await statistic(page, "Data-hazard stalls")).toHaveText("5");
  await selectInspector(page, "Pipeline regs");
  await expect(page.locator(".pipeline-table > div")).toHaveCount(5);
  await expect(page.locator(".timeline tbody tr")).not.toHaveCount(0);
  await expect(errors).toEqual([]);
});

test("hazards, forwarding, branch recovery, manual mode, cache, and every inspector", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);

  await loadExample(page, "load-use");
  await runToCompletion(page);
  await expect(await statistic(page, "Data-hazard stalls")).toHaveText("1");
  await expect(await statistic(page, "Forwarding events")).not.toHaveText("0");
  await expect(page.locator(".tl-cell.stalled")).not.toHaveCount(0);

  await loadExample(page, "raw-none");
  await applyConfiguration(page, { forwarding: "none", predictor: "two-bit", cache: false });
  await runToCompletion(page);
  await expect(await statistic(page, "Data-hazard stalls")).not.toHaveText("0");
  await expect(await statistic(page, "Forwarding events")).toHaveText("0");

  await loadExample(page, "raw-none");
  await applyConfiguration(page, { forwarding: "manual" });
  await expect(page.locator(".manual-warning")).toBeVisible();
  await runToCompletion(page);
  await expect(page.locator(".correctness-card.differs")).toContainText("Reference mismatch found");

  await loadExample(page, "mispredict");
  await applyConfiguration(page, { forwarding: "full", predictor: "always-not-taken", cache: false });
  await runToCompletion(page);
  await expect(await statistic(page, "Mispredictions")).toHaveText("1");
  await expect(await statistic(page, "Flushed instructions")).not.toHaveText("0");
  await expect(page.locator(".tl-cell.squashed")).not.toHaveCount(0);

  await loadExample(page, "cache-seq");
  await applyConfiguration(page, { forwarding: "full", predictor: "two-bit", cache: true });
  await runToCompletion(page);
  await selectInspector(page, "Cache");
  await expect(page.locator(".mini-stats")).toContainText("Hit rate");
  await expect(page.locator(".cache-set > div.valid")).not.toHaveCount(0);

  for (const inspector of ["Registers", "Memory", "Pipeline regs", "Predictor", "Cache", "Statistics", "Event log"]) {
    await selectInspector(page, inspector);
    await expect(page.locator("#inspector-panel")).toBeVisible();
  }
  await expect(errors).toEqual([]);
});

test("v1.3 microarchitecture controls, validation, presets, legacy projects, and custom benchmarks", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);
  await openConfiguration(page);
  await page.getByLabel("Microarchitecture preset").selectOption("tiny-direct");
  await page.getByRole("button", { name: "Load preset" }).click();
  await expect(page.getByLabel("Capacity (bytes)")).toHaveValue("64");
  await expect(page.getByLabel("Block size (bytes)")).toHaveValue("16");
  await expect(page.getByLabel("Associativity (ways)")).toHaveValue("1");

  await page.getByLabel("Predictor entries").fill("3");
  await page.getByRole("button", { name: "Apply & reset processor" }).click();
  await expect(page.getByRole("alert")).toContainText("Predictor entries must be a power of two");
  await expect(page.locator(".status-pill")).toContainText("ready");

  await page.getByLabel("Predictor entries").fill("8");
  await page.getByLabel("Capacity (bytes)").fill("128");
  await page.getByLabel("Associativity (ways)").fill("2");
  await page.getByLabel("Hit latency").fill("2");
  await page.getByLabel("Miss penalty").fill("11");
  await page.getByRole("button", { name: "Apply & reset processor" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await selectInspector(page, "Predictor");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(8);

  await loadExample(page, "store-forward");
  await runToCompletion(page);
  await selectInspector(page, "Registers");
  await expect(page.locator(".register-grid button").filter({ has: page.locator("span", { hasText: /^r3$/ }) })).toContainText("42");
  await expect(page.locator(".correctness-card.matches")).toContainText("Architectural result verified");
  await selectInspector(page, "Cache");
  await expect(page.locator(".cache-set")).toHaveCount(4);
  await expect(await statistic(page, "Memory stalls")).not.toHaveText("0");

  await openConfiguration(page);
  await page.getByLabel("New preset name").fill("E2E custom cache");
  await page.getByRole("button", { name: "Save current settings" }).click();
  await expect(page.locator(".preset-message")).toContainText("Saved E2E custom cache");
  await page.getByLabel("Miss penalty").fill("13");
  await page.getByLabel("New preset name").fill("E2E custom cache");
  await page.getByRole("button", { name: "Save current settings" }).click();
  await expect(page.locator(".preset-message")).toContainText("Updated E2E custom cache");
  await page.reload();
  await boot(page);
  await openConfiguration(page);
  await expect(page.getByLabel("Microarchitecture preset").locator("option", { hasText: "E2E custom cache" })).toHaveCount(1);
  await page.getByLabel("Microarchitecture preset").selectOption({ label: "E2E custom cache" });
  await page.getByRole("button", { name: "Load preset" }).click();
  await expect(page.getByLabel("Miss penalty")).toHaveValue("13");

  const legacyProject = {
    format: "pipeline-lab-project", version: 1, name: "Legacy v1 project", source: "HALT\n",
    configuration: { forwarding: "none", predictor: "one-bit", cacheEnabled: false }, breakpointLines: [],
  };
  await page.getByLabel("Import Pipeline Lab project").setInputFiles({ name: "legacy.pipeline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacyProject)) });
  await expect(page.getByLabel("Assembly source editor")).toHaveValue("HALT\n");
  await openConfiguration(page);
  await expect(page.getByLabel("Predictor entries")).toHaveValue("16");
  await expect(page.getByLabel("Capacity (bytes)")).toHaveValue("256");

  await page.getByRole("button", { name: "Learn" }).click();
  const learning = page.getByRole("dialog", { name: "Learn the pipeline by doing" });
  await learning.getByRole("button", { name: "Performance" }).click();
  await learning.getByLabel("Benchmark suite").selectOption("custom");
  await learning.getByRole("button", { name: "Run benchmark" }).click();
  await expect(learning.locator(".performance-row")).toHaveCount(7);
  await expect(learning.locator(".verified")).toHaveCount(7);
  const reportPromise = page.waitForEvent("download");
  await learning.getByRole("button", { name: "Export JSON" }).click();
  const report = JSON.parse(await readDownload(await reportPromise));
  expect(report.version).toBe(2);
  expect(report.kind).toBe("custom");
  expect(report.runs[0].configuration).toMatchObject({ predictorEntries: 16, cacheCapacity: 256, cacheBlockSize: 16, cacheAssociativity: 2, cacheHitLatency: 1, cacheMissPenalty: 8 });
  await page.keyboard.press("Escape");
  await openConfiguration(page);
  await page.getByLabel("Microarchitecture preset").selectOption({ label: "E2E custom cache" });
  await page.getByRole("button", { name: "Delete saved" }).click();
  await expect(page.locator(".preset-message")).toContainText("Deleted E2E custom cache");
  await expect(errors).toEqual([]);
});

test("assembler errors, dirty-source safety, breakpoints, memory edits while paused, and faults", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);
  const editor = page.getByLabel("Assembly source editor");
  await editor.fill("ADD r1, r2\nHALT");
  await expect(page.locator(".editor-state")).toHaveText("Changes not assembled");
  await expect(page.getByRole("button", { name: "Step cycle" })).toBeDisabled();
  await page.getByRole("button", { name: "Assemble" }).click();
  await expect(page.locator(".assembly-errors")).toContainText("Line 1");

  await editor.fill("LW r1, 2(r0)\nHALT");
  await page.getByRole("button", { name: "Assemble" }).click();
  await runToCompletion(page);
  await expect(page.locator(".status-pill")).toContainText("fault");
  await selectInspector(page, "Event log");
  await expect(page.locator(".event-list")).toContainText("Unaligned 32-bit load");

  await loadExample(page, "arithmetic");
  await page.locator('.gutter button[title="Toggle breakpoint on source line 3"]').click();
  await moreAction(page, "Run to breakpoint");
  await expect(page.locator(".status-pill")).toContainText("breakpoint");
  await page.getByRole("button", { name: "Step cycle" }).click();
  await setMemoryWord(page, 0x500, 0x12345678);
  await expect(page.locator(".hex-dump")).toContainText("78");
  await expect(errors).toEqual([]);
});

test("project persistence, downloads, learning center, ISA search, and Performance Lab", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);
  await openMore(page);
  await page.getByLabel("Project name").fill("E2E portfolio lab");
  await page.locator(".more-controls button").filter({ hasText: "Save browser draft" }).click();
  await expect(page.getByRole("status")).toContainText("saved in this browser");
  await page.getByLabel("Assembly source editor").fill("HALT");
  await openMore(page);
  await page.locator(".more-controls button").filter({ hasText: "Restore browser draft" }).click();
  await expect(page.getByLabel("Assembly source editor")).toContainText("LI r1, 0");

  await openMore(page);
  const projectDownloadPromise = page.waitForEvent("download");
  await page.locator(".more-controls button").filter({ hasText: "Download project" }).click();
  const projectDocument = JSON.parse(await readDownload(await projectDownloadPromise));
  expect(projectDocument.format).toBe("pipeline-lab-project");
  expect(projectDocument.version).toBe(2);
  expect(projectDocument.configuration).toMatchObject({ predictorEntries: 16, cacheCapacity: 256, cacheBlockSize: 16, cacheAssociativity: 2, cacheHitLatency: 1, cacheMissPenalty: 8 });
  expect(projectDocument.name).toBe("E2E portfolio lab");

  await page.getByRole("button", { name: "Step cycle" }).click();
  await openMore(page);
  const traceDownloadPromise = page.waitForEvent("download");
  await page.locator(".more-controls button").filter({ hasText: "Export execution trace" }).click();
  const traceDocument = JSON.parse(await readDownload(await traceDownloadPromise));
  expect(traceDocument.format).toBe("pipeline-lab-trace");
  expect(traceDocument.version).toBe(2);
  expect(traceDocument.timeline.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Learn" }).click();
  const learning = page.getByRole("dialog", { name: "Learn the pipeline by doing" });
  await expect(learning).toBeVisible();
  await learning.getByRole("button", { name: "ISA" }).click();
  await learning.getByLabel("Search instructions").fill("load word");
  await expect(learning.locator(".isa-list")).toContainText("LW");
  await learning.getByRole("button", { name: "Performance" }).click();
  await learning.getByRole("button", { name: "Run benchmark" }).click();
  await expect(learning.locator(".performance-row")).toHaveCount(4);
  await expect(learning.locator(".verified")).toHaveCount(4);
  const jsonPromise = page.waitForEvent("download");
  await learning.getByRole("button", { name: "Export JSON" }).click();
  const benchmark = JSON.parse(await readDownload(await jsonPromise));
  expect(benchmark.format).toBe("pipeline-lab-benchmark");
  expect(benchmark.version).toBe(2);
  expect(benchmark.runs).toHaveLength(4);
  const csvPromise = page.waitForEvent("download");
  await learning.getByRole("button", { name: "Export CSV" }).click();
  expect(await readDownload(await csvPromise)).toContain("architectural_match");
  await expect(errors).toEqual([]);
});

test("v1.3 boundary configuration, accessible cache controls, reset breakpoints, and initialized benchmarks", async ({ page }) => {
  const invalidPreset={id:"custom-invalid",name:"Invalid stored geometry",configuration:{forwarding:"full",predictor:"two-bit",predictorEntries:3,cacheEnabled:true,cacheCapacity:256,cacheBlockSize:16,cacheAssociativity:2,cacheHitLatency:1,cacheMissPenalty:8}};
  await page.addInitScript(preset=>localStorage.setItem("pipeline-lab-configuration-presets-v1",JSON.stringify([preset])),invalidPreset);
  const errors=watchRuntimeErrors(page);await boot(page);await openConfiguration(page);
  await expect(page.locator(".preset-message")).toContainText("Ignored 1 invalid saved preset");
  const cacheToggle=page.getByRole("checkbox",{name:"Educational data cache"});await cacheToggle.focus();await page.keyboard.press("Space");await expect(cacheToggle).toBeChecked();
  await page.getByLabel("Predictor entries").fill("1024");await page.getByLabel("Capacity (bytes)").fill("65536");await page.getByLabel("Block size (bytes)").fill("4");await page.getByLabel("Associativity (ways)").fill("1");await page.getByRole("button",{name:"Apply & reset processor"}).click();
  await selectInspector(page,"Predictor");await expect(page.locator(".data-table tbody tr")).toHaveCount(1024);
  await selectInspector(page,"Cache");await expect(page.locator(".cache-preview-note")).toContainText("Showing 512 of 16384 sets");await expect(page.locator(".cache-set")).toHaveCount(512);

  await loadExample(page,"arithmetic");await page.locator('.gutter button[title="Toggle breakpoint on source line 3"]').click();await page.getByRole("button",{name:"Reset",exact:true}).click();await moreAction(page,"Run to breakpoint");await expect(page.locator(".status-pill")).toContainText("breakpoint");

  const v2={format:"pipeline-lab-project",version:2,name:"V2 round trip",source:"LI r1, 1280\nLW r2, 0(r1)\nBEQ r2, r0, zero\nLI r3, 7\nHALT\nzero: LI r3, 9\nHALT\n",configuration:{forwarding:"full",predictor:"two-bit",predictorEntries:16,cacheEnabled:false,cacheCapacity:256,cacheBlockSize:16,cacheAssociativity:2,cacheHitLatency:1,cacheMissPenalty:8},breakpointLines:[]};
  await page.getByLabel("Import Pipeline Lab project").setInputFiles({name:"v2.pipeline.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(v2))});await expect(page.getByLabel("Assembly source editor")).toContainText("LI r1, 1280");
  await setMemoryWord(page,1280,5);await page.getByRole("button",{name:"Learn"}).click();const learning=page.getByRole("dialog",{name:"Learn the pipeline by doing"});await learning.getByRole("button",{name:"Performance"}).click();await learning.getByRole("button",{name:"Run benchmark"}).click();await expect(learning.locator(".performance-row")).toHaveCount(4);await expect(learning.locator(".verified")).toHaveCount(4);
  await expect(errors).toEqual([]);
});

test("infinite execution reaches a visible cycle-limit fault without destabilizing the UI", async ({ page }) => {
  const errors=watchRuntimeErrors(page);await boot(page);const editor=page.getByLabel("Assembly source editor");await editor.fill("loop: J loop\n");await page.getByRole("button",{name:"Assemble"}).click();await runToCompletion(page);await expect(page.locator(".status-pill")).toContainText("fault");await selectInspector(page,"Event log");await expect(page.locator(".event-list")).toContainText("Cycle limit reached");await expect(errors).toEqual([]);
});

test("all bundled programs assemble and complete deterministically", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await boot(page);
  await applyConfiguration(page, { forwarding: "full", predictor: "two-bit", cache: false });
  const firstPass = new Map<string, string>();
  for (const id of EXAMPLES) {
    await loadExample(page, id);
    await runToCompletion(page);
    await expect(page.locator(".status-pill")).not.toContainText("fault");
    firstPass.set(id, await page.locator(".run-status").innerText());
  }
  for (const id of EXAMPLES) {
    await loadExample(page, id);
    await runToCompletion(page);
    expect(await page.locator(".run-status").innerText()).toBe(firstPass.get(id));
  }
  await expect(errors).toEqual([]);
});
