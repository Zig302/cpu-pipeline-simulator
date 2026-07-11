export interface ExampleProgram { id: string; name: string; focus: string; source: string; }
export const examples: ExampleProgram[] = [
  { id: "arithmetic", name: "Basic arithmetic", focus: "Watch independent ALU instructions fill all six stages.", source: `# Arithmetic and logic
LI r1, 7
LI r2, 3
ADD r3, r1, r2
SUB r4, r1, r2
MUL r5, r3, r4
XOR r6, r5, r1
HALT` },
  { id: "raw-none", name: "RAW hazards — no forwarding", focus: "Select no forwarding: ID waits until each producer writes back.", source: `ADDI r1, r0, 5
ADD r2, r1, r1
SUB r3, r2, r1
HALT` },
  { id: "forwarding", name: "Forwarding paths", focus: "The same value is forwarded from consecutive pipeline stages.", source: `LI r1, 4
ADD r2, r1, r1
ADD r3, r2, r1
ADD r4, r3, r2
HALT` },
  { id: "load-use", name: "Load-use hazard", focus: "A load completes in MEM2, forcing exactly one bubble with full forwarding.", source: `LI r1, 256
LI r2, 41
SW r2, 0(r1)
LW r3, 0(r1)
ADDI r4, r3, 1
HALT` },
  { id: "store-forward", name: "Store-data forwarding", focus: "Store data is forwarded to EX without waiting for register writeback.", source: `LI r1, 320
LI r2, 10
ADDI r2, r2, 32
SW r2, 0(r1)
LW r3, 0(r1)
HALT` },
  { id: "branches", name: "Taken / not-taken branches", focus: "Compare correct and incorrect predictions resolved in EX.", source: `LI r1, 1
LI r2, 2
BEQ r1, r2, skip
ADDI r3, r0, 7
skip: BLT r1, r2, taken
ADDI r4, r0, 99
taken: ADDI r5, r0, 5
HALT` },
  { id: "mispredict", name: "Branch misprediction", focus: "Always-not-taken flushes younger instructions after EX resolves taken.", source: `LI r1, 1
BEQ r1, r1, target
ADDI r2, r0, 99
SW r1, 512(r0)
target: ADDI r3, r0, 7
HALT` },
  { id: "loop", name: "Counted loop", focus: "Dynamic instruction IDs keep repeated static PCs distinct.", source: `LI r1, 0
LI r2, 10
LI r3, 0
loop: ADD r3, r3, r1
ADDI r1, r1, 1
BLT r1, r2, loop
HALT` },
  { id: "sum", name: "Array summation", focus: "Loads, pointer arithmetic, a loop-carried dependency, and prediction interact.", source: `LI r1, 1024
LI r2, 5
LI r3, 0
LI r4, 0
loop: LW r5, 0(r1)
ADD r3, r3, r5
ADDI r1, r1, 4
ADDI r4, r4, 1
BLT r4, r2, loop
HALT` },
  { id: "cache-seq", name: "Cache-friendly sequential", focus: "Adjacent words share cache blocks, so misses are followed by hits.", source: `LI r1, 1024
LI r2, 8
LI r3, 0
loop: LW r4, 0(r1)
ADD r3, r3, r4
ADDI r1, r1, 4
ADDI r2, r2, -1
BNE r2, r0, loop
HALT` },
  { id: "cache-stride", name: "Cache-unfriendly stride", focus: "A 64-byte stride defeats spatial locality in the small teaching cache.", source: `LI r1, 1024
LI r2, 8
LI r3, 0
loop: LW r4, 0(r1)
ADD r3, r3, r4
ADDI r1, r1, 64
ADDI r2, r2, -1
BNE r2, r0, loop
HALT` },
  { id: "manual", name: "Manual NOP scheduling", focus: "In manual mode, compare an unscheduled dependency with explicit NOPs.", source: `ADDI r1, r0, 5
NOP
NOP
NOP
ADD r2, r1, r1
HALT` },
];
