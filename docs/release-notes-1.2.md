# Pipeline Lab 1.2 development notes

Version 1.2 turns the original two-way comparison into a reproducible Performance Lab while keeping all processor behavior in the C++ WebAssembly core.

## Performance Lab

- **Release matrix:** full forwarding with a two-bit predictor, no forwarding, always-not-taken prediction, and the educational cache.
- **Focused suites:** forwarding, branch prediction, and cache comparisons can be run independently.
- **Comparable metrics:** cycles, CPI, data-hazard stalls, memory stalls, mispredictions, flushes, and cache hit/miss counts.
- **Correctness gate:** each configuration is checked against the non-pipelined reference interpreter before it is marked verified.
- **Portable reports:** results can be downloaded as versioned JSON or analysis-friendly CSV.
- **Cycle-accurate explanations:** a selected live stage now follows that stage across step and undo operations, with actual register-file port values and instruction-specific memory/writeback descriptions.

Each run creates a fresh simulator, loads the exact same assembled source, applies one explicit processor configuration, and runs to the common 100,000-cycle safety limit. The visible simulator is not mutated by a benchmark.

## Acceptance criteria

- All benchmark scenarios finish deterministically and show their exact configuration.
- The current example produces architecturally equivalent output in every safe configuration.
- Cycle bars and tabular statistics agree with serialized C++ core state.
- JSON and CSV exports contain every visible result.
- Native core tests, WebAssembly verification, TypeScript checks, lint, production build, server QA, and browser interaction tests pass.

## Release status

This work is being developed on `codex/v1.2-performance-lab`. It is not the published stable release until the complete acceptance suite passes and the branch is reviewed.
