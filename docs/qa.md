# Quality assurance

Pipeline Lab has separate checks for the native CPU model, the WebAssembly boundary, the frontend build, and browser-visible behavior. A green static build alone is not sufficient.

## WebAssembly artifact lifecycle

`npm run wasm` builds Emscripten output into `out/wasm/wasm-artifact`. `scripts/publish-wasm.mjs` validates the binary, hashes the loader and binary, and atomically publishes immutable files under `frontend/src/generated`. The generated TypeScript module is the application's only import point.

`npm run verify:wasm` checks the manifest, SHA-256 hashes, generated imports, file presence, and `WebAssembly.compile`. It runs automatically before development and production builds. This avoids importing JavaScript from Vite's `public` directory and avoids overwriting a file that a Windows development server is streaming. Dev-server QA reconstructs its publisher inputs in an isolated temporary directory, so it never depends on ignored build output that may be owned or locked by another Windows account.

## Automated commands

| Command | Coverage |
|---|---|
| `npm run test:core` | Fresh native CMake build and CTest regression suite |
| `npm run wasm` | Fresh Emscripten build and immutable artifact publication |
| `npm run verify:wasm` | Artifact integrity and WebAssembly validation |
| `npm test` | Production frontend build plus Node integration tests |
| `npm run test:e2e` | Launches Chromium and stress-tests all examples, controls, inspectors, downloads, and deterministic step/undo workflows |
| `npm run lint` | TypeScript/React lint rules |
| `npm run typecheck` | TypeScript type checking |
| `npm run qa:dev` | Starts development, checks app and WASM assets, republishes WASM while serving, and rejects fatal server logs |
| `npm run qa:prod` | Serves the production Cloudflare output through local Wrangler and checks fingerprinted HTML, JS, CSS, WASM, status codes, and MIME types |
| `npm run qa:all` | WebAssembly verification, production build/tests, typecheck, lint, both server suites, and the Chromium stress suite |

The native suite covers assembler validation and encoding, all instruction classes, immediate limits, r0, dependency and forwarding cases, load-use and store-data hazards, no-forwarding and manual modes, branch flushing, loops and generated reference-model parity, undo/replay, pipeline fill/drain, predictor transitions, cache eviction/writeback, paused-edit atomicity and cache coherence, complete configuration validation/serialization, rejected-configuration atomicity, legacy defaults, configurable cache timing, delayed-EX operand preservation, deterministic reset, and alignment faults.

## Interactive browser acceptance checklist

Run `npm run dev`, open `http://localhost:3000`, and verify these workflows after automated checks pass:

1. Step Basic arithmetic by six cycles and confirm all six stages and the timeline update.
2. Run Counted loop to completion and confirm `r3 = 45`; undo one cycle and confirm halted state is restored to running.
3. Run Load-use hazard with full forwarding and confirm `r4 = 42`, one dependency stall, and forwarding events.
4. Run RAW hazards without forwarding and confirm dependency stalls with zero forwarding events.
5. Run Branch misprediction with Always not taken and confirm two younger instructions are flushed and the wrong-path register is unchanged.
6. Enable cache and run Cache-friendly sequential access; confirm reads, hits, and hit rate update.
7. Select Manual mode and confirm the unsafe-execution warning is visible and an unscheduled RAW dependency can produce the intentionally incorrect result.
8. Assemble malformed syntax and confirm a line-specific error appears without replacing the loaded program.
9. Set a source breakpoint and run to it; confirm status, PC, and current source marker agree.
10. Edit a paused memory word and confirm its little-endian byte representation.
11. Execute an unaligned `LW` and confirm the simulator enters fault state with a structured MEM2 event.
12. Confirm the browser console and development-server log contain no initialization, decode, asset-loading, or `EPERM` errors.
13. Load each built-in microarchitecture preset and confirm its geometry preview, predictor row count, and cache set/way visualization agree.
14. Attempt a three-entry predictor or inconsistent cache geometry and confirm the core rejects it without changing the running CPU.
15. Save, reload, update, and delete a named browser preset; import a v1 project and confirm the advanced fields receive documented defaults.
16. Run **Current + presets** and confirm every configuration is listed, architecturally verified, and fully represented in JSON and CSV exports.

## Release gate

A release is acceptable when native tests, a fresh WebAssembly build, artifact verification, production build, typecheck, lint, dev-server QA, production-server QA, and the Chromium stress suite pass. The manual checklist remains useful for exploratory visual review. Record any check that could not be freshly executed as an explicit limitation rather than inferring success from a different layer.
