# RISC-32 instruction set

All instructions are 32 bits and are stored little-endian. The PC is a byte address and advances by four unless redirected. `r0` always reads zero and discards writes. Arithmetic wraps modulo 2³². `SLT` and `BLT` use signed two's-complement comparison; `SRL` is logical.

## Formats

```text
R: [31:26 opcode][25:21 rd][20:16 rs1][15:11 rs2][10:0 0]
I: [31:26 opcode][25:21 rd/src2][20:16 rs1][15:0 signed immediate]
B: [31:26 opcode][25:21 rs1][20:16 rs2][15:0 signed PC-relative words]
J: [31:26 opcode][25:21 rd][20:0 signed PC-relative words]
```

Branch and jump offsets are relative to `PC + 4`. `JR` stores `rs1` in bits 25:21. `LUI` uses the I layout but ignores `rs1` and writes `imm16 << 16`. NOP and HALT use only the opcode.

## Opcodes

| Value | Mnemonic | Format | Semantics |
|---:|---|---|---|
| 0 | NOP | R | no architectural effect |
| 1 | ADD | R | `rd = rs1 + rs2` |
| 2 | SUB | R | `rd = rs1 - rs2` |
| 3 | MUL | R | low 32 bits of product |
| 4 | ADDI | I | `rd = rs1 + signext(imm16)` |
| 5–9 | AND, OR, XOR, SLL, SRL | R | bitwise/shift operations |
| 10 | SLT | R | signed less-than result |
| 11 | LW | I | `rd = memory32[rs1 + imm]` |
| 12 | SW | I | `memory32[rs1 + imm] = src2` |
| 13–15 | BEQ, BNE, BLT | B | conditional PC-relative branch |
| 16 | J | J | unconditional PC-relative jump |
| 17 | JAL | J | `rd = PC + 4`, then jump |
| 18 | JR | J-special | `PC = rs1` |
| 19 | LUI | I | `rd = imm16 << 16` |
| 20 | HALT | R | stop after older work completes |

Signed I/B immediates range from −32768 through 32767. J offsets use signed 21-bit word units. Loads, stores, and instruction fetches must be naturally aligned.

## Pseudoinstructions

- `MOV rd, rs` → `ADDI rd, rs, 0`
- `B label` → `J label`
- `RET` → `JR r31`
- `LI rd, imm` → one `ADDI` when the value fits signed 16 bits; otherwise an adjusted `LUI` followed by signed-low-half `ADDI`.

Labels may contain letters, digits, and underscores and cannot begin with a digit. Comments start with `#` or `//`. Malformed operand counts, registers, literals, labels, ranges, and memory syntax are rejected with a source line.

