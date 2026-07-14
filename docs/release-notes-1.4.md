# Pipeline Lab 1.4 — Time-travel debugger

Version 1.4 turns the timeline into an active debugger while preserving the six-stage C++ core as the only source of execution truth.

## Added

- C++ register-write and exact aligned word-store watchpoints with structured hit metadata.
- Debugger inspector for watchpoint creation, removal, PC breakpoint review, and timing guidance.
- Typed `getHistory()` and `restoreCycle()` WebAssembly APIs.
- Accessible cycle number navigation, scrubber, centered timeline window, historical event explanations, and explicit rewind.
- Project/trace format v3 with v1/v2 project migration.
- A cached explicit WASM binary loader for reliable repeated simulator creation in Performance Lab.
- A deterministic Windows browser-QA orchestrator with complete process-tree cleanup.

## Correctness rules

- Watchpoints observe committed CPU side effects only and never change cycle counts or performance statistics.
- A watchpoint stops after all activity in its cycle commits. WB hits are emitted before MEM2 hits.
- Squashed/faulting stores, cache writebacks, forwarding, and inspector edits cannot trigger a watchpoint.
- Rewind restores only snapshot-backed interactive cycles. Bulk history remains inspect-only by design.
- Failed restore targets and malformed v3 imports do not partially mutate state.

## Verification

- 48 native C++ cases, including new watchpoint/cache/squash/precedence/history/replay coverage.
- 16 frontend/build integration cases.
- 11 Chromium end-to-end scenarios covering animated stops, word stores, explicit rewind/re-hit, v3 persistence, migration, invalid import safety, all examples, and prior controls.
- Fresh native, WebAssembly, production, typecheck, lint, development-server, and production-server gates.
