# Pipeline semantics

## Six stages and latches

| Stage | Work performed | Output latch |
|---|---|---|
| IF | aligned instruction fetch, prediction, next PC, dynamic ID | IF/ID |
| ID | decode, register read, dependency interlock | ID/EX |
| EX | ALU, compare, address, forwarding, control resolution | EX/MEM1 |
| MEM1 | first fixed-latency memory/cache stage | MEM1/MEM2 |
| MEM2 | load completion or store side effect | MEM2/WB |
| WB | register write and retirement | architectural state |

Every latch contains a valid bit, dynamic ID, raw word, PC, decoded operation and registers, immediate, source line/text, operands, ALU/address/data/write values, control bits, prediction outcome, and educational stalled/bubble/squash flags.

## RAW rules

`r0` never creates a dependency. With full forwarding, ALU producers never stall a following ALU/branch/store consumer. A load in ID/EX causes one ID stall because its data will not exist until MEM2. On the following cycle the consumer can enter EX and receive data from the producer occupying MEM1/MEM2.

Forward priority is youngest producer first: EX/MEM1, then MEM1/MEM2, then MEM2/WB. An EX/MEM1 load is skipped because its data is not ready. Both ALU operands, branch compare operands, the store base, and store data use this network.

With forwarding disabled, ID waits while a matching producer occupies ID/EX, EX/MEM1, or MEM1/MEM2. WB is write-first, so ID can observe a value committed from MEM2/WB in the same cycle. Manual mode bypasses this interlock and may execute incorrectly by design.

## Bubbles, stalls, and flushing

A data stall freezes PC and IF/ID and inserts an invalid bubble into ID/EX. A cache wait freezes PC, IF/ID, ID/EX, and EX/MEM1 while older stages drain. A wrong branch direction or target, detected in EX, redirects PC and squashes the younger ID and IF instructions. Squashed instructions never advance or produce a side effect.

## Control prediction

Conditional branches consult the selected policy at IF and update the BHT at EX. The two-bit state starts weak-not-taken (`01`) and saturates between `00` and `11`. One-bit starts not-taken. Always policies still record outcomes for statistics. Direct J/JAL targets are predicted taken; JR redirects when its register target is known in EX.

## Memory/cache timing

Without the cache, every memory instruction uses MEM1 and MEM2 and never adds a variable wait. Loads produce data during MEM2. Stores modify memory during MEM2, which guarantees a squashed store cannot escape.

The optional cache is write-back and write-allocate. An access selects a set by block number, matches tags across ways, and uses the smallest LRU counter as victim. A dirty victim writes its block to backing memory before fill. `hitLatency - 1` or `hitLatency + missPenalty - 1` extra cycles are reflected as memory stalls.

## HALT and counters

HALT stops fetch when it reaches ID. It continues through all remaining stages and sets `halted` when it retires from WB; all older operations have then completed. HALT and explicit NOP retire. Bubbles and squashed instructions do not. Fetched includes wrong-path fetches. The cycle cap converts a runaway program into a deterministic fault.

