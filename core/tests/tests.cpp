#include "cpulab/core.hpp"

#include <functional>
#include <iostream>
#include <string>
#include <vector>

namespace {
int failures = 0;
#define CHECK(x) do { if (!(x)) { std::cerr << "  CHECK failed: " #x " (line " << __LINE__ << ")\n"; ++failures; } } while (0)

void test(const char* name, const std::function<void()>& fn) {
  const int before = failures;
  fn();
  std::cout << (before == failures ? "[pass] " : "[FAIL] ") << name << '\n';
}

cpulab::Simulator run(const std::string& source, const std::string& config = "{}") {
  cpulab::Simulator sim;
  CHECK(sim.loadProgram(source));
  sim.resetWithJson(config);
  sim.runUntilCompletion(10000);
  CHECK(sim.isHalted());
  return sim;
}
}

int main() {
  using namespace cpulab;
  test("encoding and decoding every format", [] {
    auto r = decode(encodeR(Op::ADD, 3, 4, 5)); CHECK(r.op == Op::ADD); CHECK(r.rd == 3); CHECK(r.rs1 == 4); CHECK(r.rs2 == 5);
    auto i = decode(encodeI(Op::ADDI, 2, 1, -17)); CHECK(i.imm == -17); CHECK(i.writesRd);
    auto b = decode(encodeB(Op::BLT, 7, 8, -3)); CHECK(b.imm == -12); CHECK(b.isBranch);
    auto j = decode(encodeJ(Op::JAL, 31, 19)); CHECK(j.imm == 76); CHECK(j.rd == 31);
  });
  test("assembler labels, comments and pseudoinstructions", [] {
    auto p = Assembler{}.assemble("# demo\nstart: LI r1, 0x12345678\n MOV r2, r1\n B done\n NOP\ndone: RET // return\n");
    CHECK(p.ok()); CHECK(p.words.size() == 6); CHECK(p.sourceLines[0] == 2); CHECK(p.labels.at("done") == 20);
  });
  test("immediate boundaries and sign extension", [] {
    auto p=Assembler{}.assemble("ADDI r1,r0,-32768\nADDI r2,r0,32767\nLUI r3,0xffff\nHALT\n");CHECK(p.ok());
    auto s=run("ADDI r1,r0,-32768\nADDI r2,r0,32767\nLUI r3,0xffff\nHALT\n");CHECK(s.registers()[1]==0xffff8000u);CHECK(s.registers()[2]==32767);CHECK(s.registers()[3]==0xffff0000u);
    CHECK(!Assembler{}.assemble("ADDI r1,r0,32768\n").ok());
  });
  test("invalid assembly is line specific", [] {
    auto p = Assembler{}.assemble("ADD r1, r2\nLW r33, 0(r0)\nBEQ r1,r2,missing\n");
    CHECK(!p.ok()); CHECK(p.errors.size() == 3); CHECK(p.errors[0].line == 1); CHECK(p.errors[2].line == 3);
  });
  test("arithmetic logic shifts comparison and r0", [] {
    auto s = run("LI r1, 7\nLI r2, 3\nADD r3,r1,r2\nSUB r4,r1,r2\nMUL r5,r1,r2\nAND r6,r1,r2\nOR r7,r1,r2\nXOR r8,r1,r2\nSLL r9,r2,r2\nSRL r10,r9,r2\nSLT r11,r2,r1\nADDI r0,r0,99\nHALT\n");
    auto r=s.registers(); CHECK(r[3]==10);CHECK(r[4]==4);CHECK(r[5]==21);CHECK(r[6]==3);CHECK(r[7]==7);CHECK(r[8]==4);CHECK(r[9]==24);CHECK(r[10]==3);CHECK(r[11]==1);CHECK(r[0]==0);
  });
  test("full forwarding and back-to-back dependencies", [] {
    auto s=run("ADDI r1,r0,4\nADD r2,r1,r1\nADD r1,r2,r2\nADD r3,r1,r2\nHALT\n");
    CHECK(s.registers()[3]==24); CHECK(s.statistics().forwardingEvents>=4); CHECK(s.statistics().dataStallCycles==0);
  });
  test("load-use and store-data forwarding", [] {
    auto s=run("LI r1,128\nLI r2,41\nSW r2,0(r1)\nLW r3,0(r1)\nADDI r4,r3,1\nSW r4,4(r1)\nHALT\n");
    CHECK(s.registers()[4]==42); CHECK(s.statistics().dataStallCycles==1); CHECK(s.memory()[132]==42);
  });
  test("no-forwarding mode stalls until writeback", [] {
    auto s=run("ADDI r1,r0,5\nADD r2,r1,r1\nHALT\n", "{\"forwarding\":\"none\"}");
    CHECK(s.registers()[2]==10); CHECK(s.statistics().dataStallCycles>=3);
  });
  test("manual mode exposes unscheduled RAW behavior", [] {
    auto s=run("ADDI r1,r0,5\nADD r2,r1,r1\nHALT\n", "{\"forwarding\":\"manual\"}");
    CHECK(s.registers()[2]==0); CHECK(s.statistics().dataStallCycles==0);
    auto comparison=s.compareReference();CHECK(comparison.find("\"matches\":false")!=std::string::npos);CHECK(comparison.find("\"register\":2")!=std::string::npos);CHECK(comparison.find("\"expected\":10")!=std::string::npos);
  });
  test("reference diagnostics confirm correct pipeline completion", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,5\nADD r2,r1,r1\nHALT\n"));CHECK(s.compareReference().find("\"comparable\":false")!=std::string::npos);s.runUntilCompletion();auto result=s.compareReference();CHECK(result.find("\"matches\":true")!=std::string::npos);CHECK(result.find("\"differences\":[]")!=std::string::npos);
  });
  test("taken branch flushes wrong-path side effects", [] {
    auto s=run("LI r1,1\nBEQ r1,r1,taken\nADDI r2,r0,99\nSW r1,256(r0)\ntaken: ADDI r3,r0,7\nHALT\n", "{\"predictor\":\"always-not-taken\"}");
    CHECK(s.registers()[2]==0);CHECK(s.registers()[3]==7);CHECK(s.memory()[256]==0);CHECK(s.statistics().mispredictions==1);CHECK(s.statistics().flushedInstructions>=1);
  });
  test("untaken branches and JAL/JR call-return", [] {
    std::string src="LI r1,1\nLI r2,2\nBEQ r1,r2,bad\nJAL r31,fn\nADDI r3,r0,7\nHALT\nbad: ADDI r4,r0,99\nHALT\nfn: ADDI r5,r0,9\nJR r31\n";
    auto p=Assembler{}.assemble(src);auto ref=ReferenceInterpreter{}.run(p);auto sim=run(src);CHECK(ref.halted);CHECK(sim.registers()==ref.registers);CHECK(sim.registers()[3]==7);CHECK(sim.registers()[4]==0);CHECK(sim.registers()[5]==9);
  });
  test("counted loop matches reference interpreter", [] {
    std::string src="LI r1,0\nLI r2,10\nloop: ADD r3,r3,r1\nADDI r1,r1,1\nBLT r1,r2,loop\nHALT\n";
    auto p=Assembler{}.assemble(src);auto ref=ReferenceInterpreter{}.run(p);auto sim=run(src);
    CHECK(ref.halted);CHECK(sim.registers()==ref.registers);CHECK(sim.registers()[3]==45);
  });
  test("generated dependency sequences match the reference model", [] {
    uint32_t seed=0x51a7u;auto next=[&](){seed=seed*1664525u+1013904223u;return seed;};
    for(int sample=0;sample<40;++sample){std::string src="LI r1,1\nLI r2,2\nLI r3,3\n";for(int i=0;i<18;++i){uint32_t x=next();int rd=1+int(x%7),a=1+int((x>>4)%7),b=1+int((x>>8)%7);switch((x>>12)%4){case 0:src+="ADD r"+std::to_string(rd)+",r"+std::to_string(a)+",r"+std::to_string(b)+"\n";break;case 1:src+="SUB r"+std::to_string(rd)+",r"+std::to_string(a)+",r"+std::to_string(b)+"\n";break;case 2:src+="XOR r"+std::to_string(rd)+",r"+std::to_string(a)+",r"+std::to_string(b)+"\n";break;default:src+="ADDI r"+std::to_string(rd)+",r"+std::to_string(a)+","+std::to_string(int(x%31)-15)+"\n";break;}}src+="HALT\n";auto p=Assembler{}.assemble(src);CHECK(p.ok());auto ref=ReferenceInterpreter{}.run(p);auto sim=run(src);CHECK(ref.halted);CHECK(sim.registers()==ref.registers);}
  });
  test("undo restores registers, cycle and deterministic replay", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,9\nHALT\n"));s.runCycles(7);auto state=s.getState();auto regs=s.registers();auto cycles=s.statistics().cycles;CHECK(s.restorePreviousCycle());s.stepCycle();CHECK(s.registers()==regs);CHECK(s.statistics().cycles==cycles);CHECK(s.getState()==state);
  });
  test("ID explanations serialize source usage and register-port values", [] {
    Simulator s;CHECK(s.loadProgram("ADD r2,r1,r1\nHALT\n"));s.setRegister(1,7);s.stepCycle();
    auto state=s.getState();CHECK(state.find("\"stage\":\"ID\"")!=std::string::npos);CHECK(state.find("\"usesRs1\":true")!=std::string::npos);CHECK(state.find("\"usesRs2\":true")!=std::string::npos);CHECK(state.find("\"rs1Value\":7")!=std::string::npos);CHECK(state.find("\"rs2Value\":7")!=std::string::npos);
    auto timeline=s.getTimeline();CHECK(timeline.find("\"rs1Value\":7")!=std::string::npos);CHECK(s.restorePreviousCycle());s.stepCycle();CHECK(s.getState()==state);
  });
  test("array summation remains deterministic through step and undo stress", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1024\nLI r2,5\nLI r3,0\nLI r4,0\nloop: LW r5,0(r1)\nADD r3,r3,r5\nADDI r1,r1,4\nADDI r4,r4,1\nBLT r4,r2,loop\nHALT\n"));
    CHECK(s.writeMemory(1024,"1,0,0,0,2,0,0,0,3,0,0,0,4,0,0,0,5,0,0,0"));
    for(int guard=0;guard<200&&!s.isHalted();++guard){s.stepCycle();auto committed=s.getState();CHECK(s.restorePreviousCycle());s.stepCycle();CHECK(s.getState()==committed);}
    CHECK(s.isHalted());CHECK(s.registers()[3]==15);CHECK(s.statistics().dataStallCycles==5);
  });
  test("paused register and memory edits are atomic and deterministic", [] {
    Simulator s;CHECK(s.loadProgram("ADDI r1,r0,1\nHALT\n"));s.stepCycle();s.setRegister(7,99);CHECK(s.registers()[7]==99);
    CHECK(s.writeMemory(512,"120,86,52,18"));CHECK(s.memory()[512]==0x78&&s.memory()[515]==0x12);
    CHECK(!s.writeMemory(520,"1,999,2"));CHECK(s.memory()[520]==0&&s.memory()[521]==0);
    CHECK(!s.writeMemory(uint32_t(s.memory().size()-1),"1,2"));CHECK(s.memory().back()==0);
  });
  test("pipeline fills and drains in N plus five cycles", [] {
    auto s=run("ADDI r1,r0,1\nADDI r2,r0,2\nHALT\n");CHECK(s.statistics().cycles==8);CHECK(s.statistics().retired==3);
  });
  test("two-bit predictor saturates and one-bit follows outcome", [] {
    BranchPredictor p;p.reset(PredictorMode::TwoBit,4);CHECK(!p.predict(0));auto a=p.update(0,true);CHECK(a.first==1&&a.second==2);CHECK(p.predict(0));p.update(0,true);auto b=p.update(0,true);CHECK(b.second==3);p.update(0,false);CHECK(p.predict(0));p.update(0,false);CHECK(!p.predict(0));
    p.reset(PredictorMode::OneBit,4);p.update(4,true);CHECK(p.predict(4));p.update(4,false);CHECK(!p.predict(4));
  });
  test("cache hit, miss, eviction and dirty writeback", [] {
    Configuration cfg;cfg.cacheCapacity=16;cfg.cacheBlockSize=4;cfg.cacheAssociativity=1;cfg.cacheHitLatency=1;cfg.cacheMissPenalty=5;DataCache c;c.reset(cfg);std::vector<uint8_t> mem(64,0);mem[0]=11;CHECK(c.beginAccess(0,false,mem)==6);CHECK(c.readWord(0)==11);CHECK(c.beginAccess(0,false,mem)==1);c.beginAccess(0,true,mem);c.writeWord(0,0x44332211);CHECK(c.beginAccess(16,false,mem)==6);CHECK(c.stats().hits==2);CHECK(c.stats().misses==2);CHECK(c.stats().dirtyWritebacks==1);CHECK(mem[0]==0x11&&mem[1]==0x22&&mem[2]==0x33&&mem[3]==0x44);
  });
  test("paused memory patches remain coherent with resident cache lines", [] {
    Configuration cfg;cfg.cacheCapacity=16;cfg.cacheBlockSize=4;cfg.cacheAssociativity=1;DataCache c;c.reset(cfg);std::vector<uint8_t> mem(64,0);mem[0]=1;c.beginAccess(0,false,mem);CHECK(c.readWord(0)==1);auto reads=c.stats().reads;c.patchByte(0,9);CHECK(c.readWord(0)==9);CHECK(c.stats().reads==reads);
  });
  test("reset and replay are deterministic", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,3\nADDI r2,r1,4\nHALT\n"));s.runUntilCompletion();auto first=s.getState();s.reset();s.runUntilCompletion();CHECK(s.getState()==first);
  });
  test("unaligned memory access faults", [] {
    Simulator s;CHECK(s.loadProgram("LW r1,2(r0)\nHALT\n"));s.runUntilCompletion();CHECK(!s.isHalted());CHECK(s.getState().find("\"faulted\":true")!=std::string::npos);
  });
  std::cout << (failures ? "FAILED: " + std::to_string(failures) : "All core tests passed") << '\n';
  return failures ? 1 : 0;
}
