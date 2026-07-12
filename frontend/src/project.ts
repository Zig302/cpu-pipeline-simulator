import type { CpuState, ReferenceComparison, TimelineFrame } from "./types";

export interface ProjectDocument {
  format: "pipeline-lab-project";
  version: 1;
  name: string;
  source: string;
  configuration: { forwarding: string; predictor: string; cacheEnabled: boolean };
  breakpointLines: number[];
}

export function createProject(name: string, source: string, configuration: ProjectDocument["configuration"], breakpointLines: number[]): ProjectDocument {
  return { format: "pipeline-lab-project", version: 1, name: name.trim() || "Untitled CPU project", source, configuration, breakpointLines };
}

export function parseProject(text: string): ProjectDocument {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Project file must contain a JSON object.");
  const project = value as Partial<ProjectDocument>;
  if (project.format !== "pipeline-lab-project" || project.version !== 1) throw new Error("Unsupported Pipeline Lab project format.");
  if (typeof project.source !== "string" || project.source.length > 250_000) throw new Error("Project source is missing or too large.");
  if (!project.configuration || !["full", "none", "manual"].includes(project.configuration.forwarding) || !["always-not-taken", "always-taken", "one-bit", "two-bit"].includes(project.configuration.predictor) || typeof project.configuration.cacheEnabled !== "boolean") throw new Error("Project processor configuration is invalid.");
  const lines = Array.isArray(project.breakpointLines) ? project.breakpointLines.filter(line => Number.isInteger(line) && line > 0 && line < 100_000) : [];
  return { format: "pipeline-lab-project", version: 1, name: typeof project.name === "string" ? project.name.slice(0, 100) : "Imported CPU project", source: project.source, configuration: project.configuration, breakpointLines: lines };
}

export function createTrace(source: string, state: CpuState, timeline: TimelineFrame[], reference: ReferenceComparison | null) {
  return { format: "pipeline-lab-trace", version: 1, exportedAt: new Date().toISOString(), source, configuration: state.configuration, finalState: state, referenceComparison: reference, timeline };
}

export function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");anchor.href = url;anchor.download = filename;anchor.click();URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");anchor.href = url;anchor.download = filename;anchor.click();URL.revokeObjectURL(url);
}
