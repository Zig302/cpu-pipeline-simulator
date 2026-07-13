# Pipeline Lab 1.2 release notes

Version 1.2 turns the original two-way comparison into a reproducible Performance Lab while keeping all processor behavior in the C++ WebAssembly core.

## Performance Lab

- **Release matrix:** full forwarding with a two-bit predictor, no forwarding, always-not-taken prediction, and the educational cache.
- **Focused suites:** forwarding, branch prediction, and cache comparisons can be run independently.
- **Comparable metrics:** cycles, CPI, data-hazard stalls, memory stalls, mispredictions, flushes, and cache hit/miss counts.
- **Correctness gate:** each configuration is checked against the non-pipelined reference interpreter before it is marked verified.
- **Portable reports:** results can be downloaded as versioned JSON or analysis-friendly CSV.
- **Cycle-accurate explanations:** a selected live stage now follows that stage across step and undo operations, with actual register-file port values and instruction-specific memory/writeback descriptions.
- **Natural ISA search:** multi-word searches match all terms rather than requiring one exact contiguous phrase.

## Correctness and usability fixes

- Fixed live stage highlights advancing while the Explanation panel retained the previous dynamic instruction.
- Added actual ID register-port values and source-usage flags to serialized C++ pipeline state.
- Corrected MEM and WB explanations so ALU pass-throughs are not described as memory accesses and writeback timing is explicit.
- Fixed register and memory editing after one or more cycle steps. The UI now disables edits only during continuous execution.
- Made multi-byte memory edits atomic: malformed or out-of-bounds input cannot partially modify memory.
- Kept paused memory edits coherent with cache lines already resident in the educational cache.
- Added structured `memory-edit` events and visible success/failure feedback.
- Removed the dev-server QA dependency on `out/wasm`; publisher regression checks now reconstruct isolated source inputs from the immutable artifact, preventing cross-account and file-lock `EPERM` failures on Windows.
- Updated Next, Vite, Wrangler, ESLint configuration, and transitive build dependencies while pinning the Node 22.14-compatible Cloudflare adapter; the release dependency audit reports zero known vulnerabilities.

## Automated browser stress suite

The Playwright/Chromium suite exercises all six pipeline stages, all 12 examples, continuous run/pause, cycle and instruction stepping, undo/replay, hazards, forwarding, branch recovery, cache behavior, all inspectors, assembly errors, breakpoints, faults, memory edits, guide and learning dialogs, project persistence, downloads, ISA search, and the Performance Lab. Every bundled program is executed twice and its summary must be deterministic.

Each run creates a fresh simulator, loads the exact same assembled source, applies one explicit processor configuration, and runs to the common 100,000-cycle safety limit. The visible simulator is not mutated by a benchmark.

## Acceptance criteria

- All benchmark scenarios finish deterministically and show their exact configuration.
- The current example produces architecturally equivalent output in every safe configuration.
- Cycle bars and tabular statistics agree with serialized C++ core state.
- JSON and CSV exports contain every visible result.
- Native core tests, WebAssembly verification, TypeScript checks, lint, production build, server QA, and browser interaction tests pass.

## Release verification

- 24 native C++ regression cases, including per-cycle Array summation undo/replay and paused-edit atomicity/cache coherence.
- 13 production-build and WebAssembly integration tests.
- 6 Chromium end-to-end stress scenarios covering every major page component and all bundled programs.
- Fresh Emscripten build, artifact hash verification, TypeScript, ESLint, development-server QA, and production-server QA.
