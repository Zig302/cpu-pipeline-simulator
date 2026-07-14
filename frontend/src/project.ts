import type { CpuState, ReferenceComparison, TimelineFrame } from "./types";
import { normalizeConfiguration, type ProcessorConfiguration } from "./configuration";

export interface ProjectDocument {
  format: "pipeline-lab-project";
  version: 3;
  name: string;
  source: string;
  configuration: ProcessorConfiguration;
  breakpointLines: number[];
  registerWatchpoints: number[];
  memoryWatchpoints: number[];
}

export function createProject(name: string, source: string, configuration: ProjectDocument["configuration"], breakpointLines: number[], registerWatchpoints: number[], memoryWatchpoints: number[]): ProjectDocument {
  return { format: "pipeline-lab-project", version: 3, name: name.trim() || "Untitled CPU project", source, configuration, breakpointLines, registerWatchpoints, memoryWatchpoints };
}

function watchpointList(value: unknown, kind: "register" | "memory", required: boolean): number[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error(`Project ${kind} watchpoints are invalid.`);
  const valid = value.every(item => Number.isSafeInteger(item) && (kind === "register" ? item >= 1 && item <= 31 : item >= 0 && item <= 65532 && item % 4 === 0));
  if (!valid) throw new Error(`Project ${kind} watchpoints are invalid.`);
  return [...new Set(value as number[])].sort((a,b)=>a-b);
}

export function parseProject(text: string): ProjectDocument {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Project file must contain a JSON object.");
  const project = value as Partial<ProjectDocument>;
  if (project.format !== "pipeline-lab-project" || !([1, 2, 3] as unknown[]).includes(project.version)) throw new Error("Unsupported Pipeline Lab project format.");
  if (typeof project.source !== "string" || project.source.length > 250_000) throw new Error("Project source is missing or too large.");
  let configuration: ProcessorConfiguration;
  try { configuration = normalizeConfiguration(project.configuration); } catch { throw new Error("Project processor configuration is invalid."); }
  const lines = Array.isArray(project.breakpointLines) ? project.breakpointLines.filter(line => Number.isInteger(line) && line > 0 && line < 100_000) : [];
  const v3 = project.version === 3;
  const registerWatchpoints = watchpointList(project.registerWatchpoints, "register", v3);
  const memoryWatchpoints = watchpointList(project.memoryWatchpoints, "memory", v3);
  return { format: "pipeline-lab-project", version: 3, name: typeof project.name === "string" ? project.name.slice(0, 100) : "Imported CPU project", source: project.source, configuration, breakpointLines: lines, registerWatchpoints, memoryWatchpoints };
}

export function createTrace(source: string, state: CpuState, timeline: TimelineFrame[], reference: ReferenceComparison | null) {
  return { format: "pipeline-lab-trace", version: 3, exportedAt: new Date().toISOString(), source, configuration: state.configuration, finalState: state, referenceComparison: reference, timeline };
}

export function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");anchor.href = url;anchor.download = filename;anchor.click();URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");anchor.href = url;anchor.download = filename;anchor.click();URL.revokeObjectURL(url);
}
