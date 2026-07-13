# Processor configuration

Pipeline Lab 1.3 exposes the timing parameters already owned by the C++ processor model. React collects values and renders validation results; `Simulator::validateConfigurationJson` and `Simulator::applyConfigurationJson` remain authoritative.

Applying a configuration is atomic. If any field is malformed, unknown, out of range, or geometrically inconsistent, the core returns structured errors and leaves the program, pipeline, registers, memory, statistics, and current configuration unchanged.

## Fields and defaults

| Field | Default | Accepted values |
|---|---:|---|
| Hazard handling | Full forwarding | `full`, `none`, or intentionally unsafe `manual` |
| Branch predictor | Two-bit | Always not taken, always taken, one-bit, or two-bit |
| Predictor entries | 16 | Power of two from 1 through 1,024 |
| Data cache | Disabled | Enabled or disabled |
| Capacity | 256 B | Power of two from 16 B through 65,536 B |
| Block size | 16 B | Power of two from 4 B through 256 B |
| Associativity | 2 ways | Power of two from 1 through 16 ways |
| Hit latency | 1 cycle | 1 through 20 cycles |
| Miss penalty | 8 cycles | 1 through 1,000 additional cycles |

Capacity must be divisible by `block size × associativity`, and that product cannot exceed capacity. The preview in the workbench displays the resulting set count, but only the core decides whether the configuration is valid.

## Presets

- **Balanced baseline:** full forwarding, 16-entry two-bit predictor, cache disabled.
- **Tiny direct-mapped cache:** 64 B, 16 B blocks, one way. This emphasizes conflict misses.
- **Spatial locality:** 512 B, 32 B blocks, four ways. This favors sequential accesses.
- **Branch aliasing lab:** four predictor entries. This makes BHT aliasing easier to observe.
- **Slow memory:** three-cycle cache hits and a 30-cycle miss penalty.

Users can save, update, and delete up to 20 named presets in browser local storage. These preferences never cross the C++ boundary and do not alter CPU behavior until a preset is loaded and applied. Project files persist the active expanded configuration, not the local preset library.

## Performance Lab

The **Current + presets** suite creates an independent C++ WebAssembly simulator for the active configuration and every built-in or locally saved preset. Each run uses the same assembled source, executes to the common cycle limit, and must match the non-pipelined reference interpreter. Version 2 benchmark JSON and CSV exports include every geometry and timing field.

## Project migration

Version 2 project files store the complete processor configuration. Version 1 projects remain accepted; omitted v1.3 fields receive the defaults in the table above before the configuration is validated by C++. Invalid imported values do not replace the running program.
