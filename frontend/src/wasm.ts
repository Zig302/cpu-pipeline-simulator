import createCpuLab, { WASM_BUILD, wasmUrl } from "./generated/wasm-artifact";
import type { CoreSimulator } from "./types";

type CpuModule = { Simulator: new () => CoreSimulator };
type CpuModuleFactory = (opts: { locateFile: (path: string) => string; wasmBinary: Uint8Array<ArrayBuffer> }) => Promise<CpuModule>;

let binaryPromise: Promise<Uint8Array<ArrayBuffer>> | null = null;
async function loadBinary(): Promise<Uint8Array<ArrayBuffer>> {
  if (!binaryPromise) binaryPromise = fetch(wasmUrl).then(async response => {
    if (!response.ok) throw new Error(`Failed to fetch the WASM binary (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { binaryPromise=null;throw error; });
  return binaryPromise;
}

export async function createSimulator(): Promise<CoreSimulator> {
  try {
    if (typeof window === "undefined") throw new Error("The simulator can only initialize in a browser.");
    const createModule = createCpuLab as unknown as CpuModuleFactory;
    // Supplying the immutable binary avoids Emscripten's streaming-fetch fallback
    // and lets benchmark simulators safely share one verified browser download.
    const runtime = await createModule({ locateFile: () => wasmUrl, wasmBinary: new Uint8Array(await loadBinary()) });
    return new runtime.Simulator();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The C++ WebAssembly core (${WASM_BUILD}) could not initialize: ${message}`);
  }
}
