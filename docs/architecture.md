# Architecture

## Boundaries

`cpulab_core` is a freestanding C++20 library. It owns assembly, decoding, the program image, register and memory state, all five inter-stage latches, the predictor, the cache, statistics, events, timeline records, snapshots, breakpoints, and faults.

The Embind layer exposes value-oriented operations returning JSON strings. No C++ pointer crosses the boundary. `frontend/src/types.ts` documents the serialized contract. React may schedule calls and render results but never calculates a CPU result.

Configuration follows the same boundary. `validateConfigurationJson` parses and validates a candidate without mutation; `applyConfigurationJson` repeats validation, commits the complete configuration, and resets only on success. The serialized state echoes every applied predictor and cache field. TypeScript owns preset names and browser-local persistence, but not processor validation or timing.

The browser module uses a fixed 128 MiB WebAssembly memory. This avoids resizable-buffer incompatibilities in browser `TextDecoder` implementations while retaining enough space for the bounded 500-cycle snapshot history.

## Core components

- `Assembler`: two passes. Pass one assigns byte addresses after pseudo expansion; pass two validates operands and emits words plus source-line mapping.
- `decode`: the common formal decoder used by the pipeline and reference interpreter.
- `ReferenceInterpreter`: sequential architectural oracle used by comparison tests.
- `Simulator`: simultaneous next-state cycle engine, architectural state, event producer, timeline, and bounded undo snapshots.
- `BranchPredictor`: direct-mapped BHT with tag, state, last outcome, and selectable update policy.
- `DataCache`: set/way organization with LRU victim selection, write-allocate fill, dirty eviction, and latency reporting.

## State flow

At the beginning of a cycle the simulator snapshots state. WB commits, MEM2 completes the older data operation, MEM1 applies any configured cache wait, EX calculates/forwards/resolves control, ID either advances or interlocks, and IF selects the next PC. These computations populate next-state latches. The latches replace current state only after the decisions are complete.

Runtime faults set a sticky `faulted` state and stop fetch. Events are structured records containing type, cycle, stage, dynamic instruction IDs, optional register/source, and a human explanation.

## Determinism and undo

There are no clocks, threads, random replacements, or frontend-owned architectural values in the core. Cache LRU uses a deterministic access counter. A snapshot stores architectural state, pipeline latches, predictor/cache, status, statistics, and timeline length. Restoring and replaying the same cycle produces byte-identical state JSON.
