# Pipeline Lab 1.3 release notes

Version 1.3 turns the fixed educational cache toggle into a configurable microarchitecture workbench while preserving the C++ core as the only timing authority.

## Configurable microarchitecture

- Predictor table sizes from 1 to 1,024 entries.
- Cache capacity, block size, associativity, hit latency, and miss penalty controls.
- Live set-count and timing preview.
- Five built-in experiment presets.
- Up to 20 named browser-local presets with save, update, load, and delete workflows.
- C++-generated validation errors for malformed, unknown, out-of-range, and inconsistent fields.
- Atomic application: a rejected configuration cannot partially reset or mutate the simulator.

## Reproducible comparisons and persistence

- A **Current + presets** Performance Lab suite compares the active processor against all built-in and saved configurations.
- Benchmark format version 2 records every predictor and cache parameter in JSON and CSV.
- Project and trace format version 2 preserve the expanded configuration.
- Version 1 project files migrate with documented v1.3 defaults before core validation.

## Correctness fix

Long cache misses now refresh operands held in ID/EX from the architectural register file as older producers retire. Previously, a younger instruction that expected next-cycle forwarding could retain a stale decode-time operand after the producer left the pipeline. Native and browser tests cover a forwarded store followed by a load under configurable miss latency.

## Verification target

- 28 native C++ regression cases.
- 14 production-build and integration tests.
- 7 Chromium end-to-end scenarios, including every bundled program twice and the complete v1.3 preset/configuration workflow.
- Fresh WebAssembly publication and hash verification, TypeScript, ESLint, dev-server QA, production-server QA, dependency audit, and independent QA review.
