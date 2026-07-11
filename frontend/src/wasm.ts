import createCpuLab, { WASM_BUILD, wasmUrl } from "./generated/wasm-artifact";
import type { CoreSimulator } from "./types";

type CpuModule = { Simulator: new () => CoreSimulator };
type CpuModuleFactory = (opts: { locateFile: (path: string) => string }) => Promise<CpuModule>;

export async function createSimulator(): Promise<CoreSimulator> {
  try {
    if (typeof window === "undefined") throw new Error("The simulator can only initialize in a browser.");
    const createModule = createCpuLab as unknown as CpuModuleFactory;
    const runtime = await createModule({ locateFile: () => wasmUrl });
    return new runtime.Simulator();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The C++ WebAssembly core (${WASM_BUILD}) could not initialize: ${message}`);
  }
}
