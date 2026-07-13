import type { CpuState, ReferenceComparison } from "./types";
import type { ProcessorConfiguration } from "./configuration";

export interface LessonCheckpoint {
  title: string;
  instruction: string;
  passed: (state: CpuState, reference: ReferenceComparison | null) => boolean;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  exampleId: string;
  configuration?: Partial<ProcessorConfiguration>;
  checkpoints: LessonCheckpoint[];
}

export const lessons: Lesson[] = [
  {
    id: "pipeline-basics",
    title: "Pipeline fill and drain",
    summary: "Follow independent instructions through all six stages.",
    exampleId: "arithmetic",
    checkpoints: [
      { title: "Fetch", instruction: "Step one cycle and find the first instruction in ID.", passed: state => state.statistics.cycles >= 1 },
      { title: "Fill", instruction: "Keep stepping until at least three pipeline latches are valid.", passed: state => state.pipeline.filter(slot => slot.valid).length >= 3 },
      { title: "Drain", instruction: "Run to completion and confirm every instruction retires.", passed: state => state.halted && state.statistics.retired >= 7 },
    ],
  },
  {
    id: "load-use",
    title: "Load-use hazard",
    summary: "Observe the one-cycle wait imposed by MEM2 load completion.",
    exampleId: "load-use",
    configuration: { forwarding: "full" },
    checkpoints: [
      { title: "Detect", instruction: "Step until the dependency stall counter increases.", passed: state => state.statistics.dataStallCycles >= 1 },
      { title: "Forward", instruction: "Continue until the loaded value is forwarded to EX.", passed: state => state.statistics.forwardingEvents >= 1 },
      { title: "Verify", instruction: "Complete execution; r4 should equal 42.", passed: state => state.halted && state.registers[4] === 42 },
    ],
  },
  {
    id: "branch-recovery",
    title: "Branch prediction recovery",
    summary: "See younger instructions flushed after an EX-stage misprediction.",
    exampleId: "mispredict",
    configuration: { predictor: "always-not-taken" },
    checkpoints: [
      { title: "Predict", instruction: "Step until the conditional branch reaches EX.", passed: state => state.statistics.branches >= 1 },
      { title: "Recover", instruction: "Find a misprediction and flushed younger instruction.", passed: state => state.statistics.mispredictions >= 1 && state.statistics.flushedInstructions >= 1 },
      { title: "Verify", instruction: "Complete execution; wrong-path r2 must remain zero.", passed: state => state.halted && state.registers[2] === 0 && state.registers[3] === 7 },
    ],
  },
  {
    id: "manual-correctness",
    title: "Why manual scheduling fails",
    summary: "Compare an unsafe schedule with the architectural reference interpreter.",
    exampleId: "raw-none",
    configuration: { forwarding: "manual" },
    checkpoints: [
      { title: "Run unsafe", instruction: "Run the unscheduled program to completion in Manual mode.", passed: state => state.halted },
      { title: "Diagnose", instruction: "Open the correctness coach and inspect the differing register.", passed: (_state, reference) => reference?.comparable === true && !reference.matches },
    ],
  },
];

export interface IsaEntry { mnemonic: string; format: string; syntax: string; description: string; }

export const isaReference: IsaEntry[] = [
  { mnemonic: "ADD", format: "R", syntax: "ADD rd, rs1, rs2", description: "Add two registers." },
  { mnemonic: "SUB", format: "R", syntax: "SUB rd, rs1, rs2", description: "Subtract rs2 from rs1." },
  { mnemonic: "MUL", format: "R", syntax: "MUL rd, rs1, rs2", description: "Multiply the low 32 bits." },
  { mnemonic: "ADDI", format: "I", syntax: "ADDI rd, rs1, imm", description: "Add a signed 16-bit immediate." },
  { mnemonic: "AND / OR / XOR", format: "R", syntax: "AND rd, rs1, rs2", description: "Bitwise register operations." },
  { mnemonic: "SLL / SRL", format: "R", syntax: "SLL rd, rs1, rs2", description: "Logical shift by rs2[4:0]." },
  { mnemonic: "SLT", format: "R", syntax: "SLT rd, rs1, rs2", description: "Signed less-than comparison." },
  { mnemonic: "LW", format: "I", syntax: "LW rd, offset(rs1)", description: "Load one aligned little-endian word." },
  { mnemonic: "SW", format: "S", syntax: "SW rs2, offset(rs1)", description: "Store one aligned little-endian word." },
  { mnemonic: "BEQ / BNE / BLT", format: "B", syntax: "BEQ rs1, rs2, label", description: "EX-resolved conditional branch." },
  { mnemonic: "J", format: "J", syntax: "J label", description: "PC-relative unconditional jump." },
  { mnemonic: "JAL", format: "J", syntax: "JAL rd, label", description: "Jump and save the return address." },
  { mnemonic: "JR", format: "I", syntax: "JR rs1", description: "Jump to the address in rs1." },
  { mnemonic: "LUI", format: "U", syntax: "LUI rd, imm", description: "Load a 16-bit value into the upper half." },
  { mnemonic: "NOP / HALT", format: "R", syntax: "HALT", description: "Retire no work, or stop after older instructions complete." },
  { mnemonic: "LI / MOV / B / RET", format: "Pseudo", syntax: "LI rd, imm", description: "Assembler pseudoinstructions documented in the ISA guide." },
];

export function checkpointIndex(lesson: Lesson, state: CpuState, reference: ReferenceComparison | null): number {
  return lesson.checkpoints.findIndex(checkpoint => !checkpoint.passed(state, reference));
}
