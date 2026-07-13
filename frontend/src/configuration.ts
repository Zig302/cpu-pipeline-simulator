export type ForwardingMode = "full" | "none" | "manual";
export type PredictorMode = "always-not-taken" | "always-taken" | "one-bit" | "two-bit";

export interface ProcessorConfiguration {
  forwarding: ForwardingMode;
  predictor: PredictorMode;
  predictorEntries: number;
  cacheEnabled: boolean;
  cacheCapacity: number;
  cacheBlockSize: number;
  cacheAssociativity: number;
  cacheHitLatency: number;
  cacheMissPenalty: number;
}

export interface ConfigurationValidation {
  ok: boolean;
  configuration: ProcessorConfiguration;
  errors: string[];
}

export interface ConfigurationPreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  configuration: ProcessorConfiguration;
}

export const DEFAULT_CONFIGURATION: ProcessorConfiguration = {
  forwarding: "full",
  predictor: "two-bit",
  predictorEntries: 16,
  cacheEnabled: false,
  cacheCapacity: 256,
  cacheBlockSize: 16,
  cacheAssociativity: 2,
  cacheHitLatency: 1,
  cacheMissPenalty: 8,
};

const configured = (overrides: Partial<ProcessorConfiguration>): ProcessorConfiguration => ({ ...DEFAULT_CONFIGURATION, ...overrides });

export const BUILT_IN_PRESETS: ConfigurationPreset[] = [
  { id: "balanced", name: "Balanced baseline", description: "Full forwarding, 16-entry two-bit predictor, cache disabled.", builtIn: true, configuration: configured({}) },
  { id: "tiny-direct", name: "Tiny direct-mapped cache", description: "64 B capacity, 16 B blocks, one way; useful for conflict misses.", builtIn: true, configuration: configured({ cacheEnabled: true, cacheCapacity: 64, cacheBlockSize: 16, cacheAssociativity: 1 }) },
  { id: "spatial", name: "Spatial locality", description: "512 B, four-way cache with 32 B blocks for sequential workloads.", builtIn: true, configuration: configured({ cacheEnabled: true, cacheCapacity: 512, cacheBlockSize: 32, cacheAssociativity: 4, cacheMissPenalty: 12 }) },
  { id: "branch-pressure", name: "Branch aliasing lab", description: "A four-entry two-bit predictor makes table aliasing visible.", builtIn: true, configuration: configured({ predictorEntries: 4 }) },
  { id: "slow-memory", name: "Slow memory", description: "Three-cycle hits and a 30-cycle miss penalty amplify memory stalls.", builtIn: true, configuration: configured({ cacheEnabled: true, cacheHitLatency: 3, cacheMissPenalty: 30 }) },
];

export const CUSTOM_PRESET_STORAGE_KEY = "pipeline-lab-configuration-presets-v1";

const integer = (value: unknown, fallback: number, field: string): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Preset field '${field}' must be an integer.`);
  return value;
};

export function normalizeConfiguration(value: unknown): ProcessorConfiguration {
  if (!value || typeof value !== "object") throw new Error("Processor configuration must be an object.");
  const candidate = value as Partial<ProcessorConfiguration>;
  if (!(["full", "none", "manual"] as unknown[]).includes(candidate.forwarding)) throw new Error("Processor forwarding mode is invalid.");
  if (!(["always-not-taken", "always-taken", "one-bit", "two-bit"] as unknown[]).includes(candidate.predictor)) throw new Error("Processor predictor mode is invalid.");
  if (typeof candidate.cacheEnabled !== "boolean") throw new Error("Processor cache setting is invalid.");
  return {
    forwarding: candidate.forwarding as ForwardingMode,
    predictor: candidate.predictor as PredictorMode,
    predictorEntries: integer(candidate.predictorEntries, DEFAULT_CONFIGURATION.predictorEntries, "predictorEntries"),
    cacheEnabled: candidate.cacheEnabled,
    cacheCapacity: integer(candidate.cacheCapacity, DEFAULT_CONFIGURATION.cacheCapacity, "cacheCapacity"),
    cacheBlockSize: integer(candidate.cacheBlockSize, DEFAULT_CONFIGURATION.cacheBlockSize, "cacheBlockSize"),
    cacheAssociativity: integer(candidate.cacheAssociativity, DEFAULT_CONFIGURATION.cacheAssociativity, "cacheAssociativity"),
    cacheHitLatency: integer(candidate.cacheHitLatency, DEFAULT_CONFIGURATION.cacheHitLatency, "cacheHitLatency"),
    cacheMissPenalty: integer(candidate.cacheMissPenalty, DEFAULT_CONFIGURATION.cacheMissPenalty, "cacheMissPenalty"),
  };
}

export function parseCustomPresets(text: string | null): ConfigurationPreset[] {
  if (!text) return [];
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error("Saved processor presets are not an array.");
  return value.slice(0, 20).map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Saved preset ${index + 1} is invalid.`);
    const preset = entry as { id?: unknown; name?: unknown; configuration?: unknown };
    if (typeof preset.id !== "string" || !/^custom-[a-z0-9-]+$/i.test(preset.id)) throw new Error(`Saved preset ${index + 1} has an invalid identifier.`);
    if (typeof preset.name !== "string" || !preset.name.trim()) throw new Error(`Saved preset ${index + 1} needs a name.`);
    return { id: preset.id, name: preset.name.trim().slice(0, 60), description: "Saved in this browser.", builtIn: false, configuration: normalizeConfiguration(preset.configuration) };
  });
}

export function serializeCustomPresets(presets: ConfigurationPreset[]): string {
  return JSON.stringify(presets.filter(preset => !preset.builtIn).map(({ id, name, configuration }) => ({ id, name, configuration })));
}

export function configurationSummary(configuration: ProcessorConfiguration): string {
  const cache = configuration.cacheEnabled ? `${configuration.cacheCapacity} B / ${configuration.cacheAssociativity}-way` : "cache off";
  return `${configuration.forwarding} forwarding · ${configuration.predictor} (${configuration.predictorEntries}) · ${cache}`;
}
