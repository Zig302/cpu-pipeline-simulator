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

async function applyConfiguration(page: Page, options: { forwarding?: string; predictor?: string; cache?: boolean }) {
  await openConfiguration(page);
  if (options.forwarding) await page.getByLabel("Hazard handling").selectOption(options.forwarding);
  if (options.predictor) await page.getByLabel("Branch predictor").selectOption(options.predictor);
  if (options.cache !== undefined) {
    const cache=page.locator(".configuration input[type=checkbox]");
    if ((await cache.isChecked())!==options.cache)await page.locator(".configuration .switch").click();
    await expect(cache).toBeChecked({ checked: options.cache });
  }
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
  expect(projectDocument.name).toBe("E2E portfolio lab");

  await page.getByRole("button", { name: "Step cycle" }).click();
  await openMore(page);
  const traceDownloadPromise = page.waitForEvent("download");
  await page.locator(".more-controls button").filter({ hasText: "Export execution trace" }).click();
  const traceDocument = JSON.parse(await readDownload(await traceDownloadPromise));
  expect(traceDocument.format).toBe("pipeline-lab-trace");
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
  expect(benchmark.runs).toHaveLength(4);
  const csvPromise = page.waitForEvent("download");
  await learning.getByRole("button", { name: "Export CSV" }).click();
  expect(await readDownload(await csvPromise)).toContain("architectural_match");
  await expect(errors).toEqual([]);
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
