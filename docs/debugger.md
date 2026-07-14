# Debugger and time travel

## Stop conditions

Pipeline Lab keeps debugger decisions in the C++ core. A register watchpoint accepts `r1` through `r31` and fires when an instruction commits that register write in WB. A word-store watchpoint accepts a naturally aligned, in-bounds address and fires when an `SW` commits at that exact start address in MEM2. Both trigger even when the new value equals the old value because the architectural write still occurred.

Watchpoints do not fire for forwarding selections, loads, dirty cache writebacks, squashed or faulting instructions, or paused inspector edits. Up to 64 watchpoints of each kind are accepted. Multiple hits in one atomic cycle are emitted in pipeline age order: WB before MEM2. Fault and HALT remain terminal processor conditions; a watchpoint otherwise becomes the visible debug stop after the entire cycle commits.

Use **Debugger** under State inspectors to add or remove watchpoints. Source-line PC breakpoints remain available from the editor gutter. **Run to debug stop**, **Run to completion**, animated **Run**, and **Step instruction** all honor watchpoint stops. A subsequent execution action resumes from the next cycle.

## Timeline selection and rewind

Selecting a cycle is non-mutating. The cycle number field and scrubber center a bounded 28-column timeline window on any retained frame, and historical frame events supply the Explanation panel. State inspectors are always labeled as live CPU state so historical inspection cannot be mistaken for restoration.

**Rewind to C…** is a separate destructive action. It is enabled only when the target has a retained C++ snapshot. A successful rewind restores registers, coherent memory/cache state, predictor state, all pipeline latches and dynamic IDs, statistics, status, and timeline truncation; future frames are discarded. Replaying the same calls produces the same state and watchpoint hit.

Interactive cycle/instruction stepping, direct cycle runs, and animated Run retain at most 500 full snapshots. Bulk **Run to completion** and **Run to debug stop** remain snapshot-free to protect the fixed 128 MiB WebAssembly heap, while retaining up to 1,000 timeline frames for inspection. Those frames are explicitly labeled **INSPECT ONLY**.

## Project compatibility

Project format v3 stores `registerWatchpoints` and `memoryWatchpoints` along with source, configuration, and source breakpoints. Imports validate the complete document before replacing the loaded project. v1 and v2 files migrate to v3 with empty watchpoint sets. Invalid, oversized, unaligned, or out-of-range definitions are rejected without changing the current editor or CPU project.
