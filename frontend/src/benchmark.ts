import type { Stats } from "./types";

export type BenchmarkKind = "suite" | "forwarding" | "prediction" | "cache";
export interface ProcessorConfiguration { forwarding: string; predictor: string; cacheEnabled: boolean; }
export interface BenchmarkScenario { id: string; label: string; configuration: ProcessorConfiguration; }
export interface BenchmarkRun {
  id: string;
  label: string;
  configuration: ProcessorConfiguration;
  statistics: Stats;
  cache: { reads: number; writes: number; hits: number; misses: number; dirtyWritebacks: number };
  architecturalMatch: boolean;
}
export interface BenchmarkReport {
  format: "pipeline-lab-benchmark";
  version: 1;
  createdAt: string;
  title: string;
  kind: BenchmarkKind;
  source: string;
  runs: BenchmarkRun[];
}

const configured = (base: ProcessorConfiguration, overrides: Partial<ProcessorConfiguration>): ProcessorConfiguration => ({ ...base, ...overrides });

export function benchmarkScenarios(kind: BenchmarkKind, base: ProcessorConfiguration): BenchmarkScenario[] {
  const baseline = { id: "baseline", label: "Full · 2-bit · no cache", configuration: configured(base, { forwarding: "full", predictor: "two-bit", cacheEnabled: false }) };
  if (kind === "forwarding") return [baseline, { id: "no-forwarding", label: "No forwarding", configuration: configured(baseline.configuration, { forwarding: "none" }) }];
  if (kind === "prediction") return [baseline, { id: "always-not-taken", label: "Always not taken", configuration: configured(baseline.configuration, { predictor: "always-not-taken" }) }, { id: "always-taken", label: "Always taken", configuration: configured(baseline.configuration, { predictor: "always-taken" }) }];
  if (kind === "cache") return [baseline, { id: "cache-enabled", label: "Educational cache", configuration: configured(baseline.configuration, { cacheEnabled: true }) }];
  return [baseline, { id: "no-forwarding", label: "No forwarding", configuration: configured(baseline.configuration, { forwarding: "none" }) }, { id: "always-not-taken", label: "Always not taken", configuration: configured(baseline.configuration, { predictor: "always-not-taken" }) }, { id: "cache-enabled", label: "Educational cache", configuration: configured(baseline.configuration, { cacheEnabled: true }) }];
}

export function createBenchmarkReport(title: string, kind: BenchmarkKind, source: string, runs: BenchmarkRun[]): BenchmarkReport {
  return { format: "pipeline-lab-benchmark", version: 1, createdAt: new Date().toISOString(), title, kind, source, runs };
}

export function benchmarkCsv(report: BenchmarkReport): string {
  const header = ["configuration", "cycles", "retired", "cpi", "data_stalls", "memory_stalls", "mispredictions", "flushed", "cache_hits", "cache_misses", "architectural_match"];
  const rows = report.runs.map(run => [run.label, run.statistics.cycles, run.statistics.retired, run.statistics.cpi.toFixed(4), run.statistics.dataStallCycles, run.statistics.memoryStallCycles, run.statistics.mispredictions, run.statistics.flushedInstructions, run.cache.hits, run.cache.misses, run.architecturalMatch]);
  const escape = (value: string | number | boolean) => `"${String(value).replaceAll('"', '""')}"`;
  return [header, ...rows].map(row => row.map(escape).join(",")).join("\n");
}

export function bestRun(report: BenchmarkReport): BenchmarkRun | null {
  return report.runs.reduce<BenchmarkRun | null>((best, run) => !best || run.statistics.cycles < best.statistics.cycles ? run : best, null);
}
