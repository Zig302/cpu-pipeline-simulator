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
  test("register watchpoints stop on committed WB writes with structured values", [] {
    Simulator s;CHECK(s.loadProgram("ADDI r1,r0,5\nADDI r2,r1,1\nHALT\n"));CHECK(!s.setRegisterWatchpoint(0));CHECK(!s.setRegisterWatchpoint(32));CHECK(s.setRegisterWatchpoint(1));CHECK(s.setRegisterWatchpoint(1));
    s.runCycles(100);const auto state=s.getState();CHECK(s.registers()[1]==5);CHECK(!s.isHalted());CHECK(state.find("\"status\":\"watchpoint\"")!=std::string::npos);CHECK(state.find("\"watchpointKind\":\"register\"")!=std::string::npos);CHECK(state.find("\"stage\":\"WB\"")!=std::string::npos);CHECK(state.find("\"oldValue\":0,\"newValue\":5")!=std::string::npos);CHECK(s.getTimeline().find("\"type\":\"watchpoint\"")!=std::string::npos);
    CHECK(s.setRegisterWatchpoint(1,false));s.runUntilCompletion();CHECK(s.isHalted());
  });
  test("word-store watchpoints stop in MEM2 and ignore debugger edits", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1024\nLI r2,42\nSW r2,0(r1)\nHALT\n"));CHECK(!s.setMemoryWatchpoint(1025));CHECK(!s.setMemoryWatchpoint(uint32_t(s.memory().size())));CHECK(s.setMemoryWatchpoint(1024));
    CHECK(s.writeMemory(1024,"7,0,0,0"));CHECK(s.getState().find("\"status\":\"watchpoint\"")==std::string::npos);s.runUntilCompletion();const auto state=s.getState();CHECK(state.find("\"status\":\"watchpoint\"")!=std::string::npos);CHECK(state.find("\"watchpointKind\":\"memory\"")!=std::string::npos);CHECK(state.find("\"access\":\"write\"")!=std::string::npos);CHECK(state.find("\"address\":1024,\"oldValue\":7,\"newValue\":42")!=std::string::npos);CHECK(s.readMemory(1024,4)=="[42,0,0,0]");
    s.runUntilCompletion();CHECK(s.isHalted());
  });
  test("cached store watchpoints fire once after miss service", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1024\nLI r2,99\nSW r2,0(r1)\nHALT\n"));CHECK(s.applyConfigurationJson("{\"cacheEnabled\":true,\"cacheMissPenalty\":8}").find("\"ok\":true")!=std::string::npos);CHECK(s.setMemoryWatchpoint(1024));s.runCycles(100);
    const auto state=s.getState();CHECK(state.find("\"status\":\"watchpoint\"")!=std::string::npos);CHECK(state.find("\"newValue\":99")!=std::string::npos);CHECK(s.statistics().memoryStallCycles>0);CHECK(s.statistics().memoryWrites==1);CHECK(s.readMemory(1024,4)=="[99,0,0,0]");
  });
  test("watchpoint definitions are bounded, persistent, and emit simultaneous hits in order", [] {
    Simulator definitions;CHECK(definitions.loadProgram("HALT\n"));for(uint32_t a=0;a<256;a+=4)CHECK(definitions.setMemoryWatchpoint(a));CHECK(!definitions.setMemoryWatchpoint(256));CHECK(definitions.setMemoryWatchpoint(0,false));CHECK(definitions.setMemoryWatchpoint(256));CHECK(definitions.setRegisterWatchpoint(7));definitions.reset();const auto persisted=definitions.getState();CHECK(persisted.find("\"registerWatchpoints\":[7]")!=std::string::npos);CHECK(persisted.find("\"memoryWatchpoints\":[4,8")!=std::string::npos);
    Simulator simultaneous;CHECK(simultaneous.loadProgram("ADDI r7,r0,5\nSW r0,1024(r0)\nHALT\n"));CHECK(simultaneous.setRegisterWatchpoint(7));CHECK(simultaneous.setMemoryWatchpoint(1024));simultaneous.runCycles(100);const auto events=simultaneous.getEvents();const auto reg=events.find("\"watchpointKind\":\"register\"");const auto mem=events.find("\"watchpointKind\":\"memory\"");CHECK(reg!=std::string::npos&&mem!=std::string::npos&&reg<mem);CHECK(events.find("\"oldValue\":0,\"newValue\":0",mem)!=std::string::npos);
  });
  test("squashed side effects never trigger watchpoints", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1\nBEQ r1,r1,taken\nADDI r7,r0,99\nSW r1,1024(r0)\ntaken: HALT\n"));CHECK(s.applyConfigurationJson("{\"predictor\":\"always-not-taken\"}").find("\"ok\":true")!=std::string::npos);CHECK(s.setRegisterWatchpoint(7));CHECK(s.setMemoryWatchpoint(1024));s.runUntilCompletion();
    CHECK(s.isHalted());CHECK(s.registers()[7]==0);CHECK(s.readMemory(1024,4)=="[0,0,0,0]");CHECK(s.getState().find("\"type\":\"watchpoint\"")==std::string::npos);
  });
  test("watchpoints preserve terminal timing and cycle-limit precedence", [] {
    Simulator base;CHECK(base.loadProgram("ADDI r1,r0,1\n"));base.runUntilCompletion();const auto cycles=base.statistics().cycles;
    Simulator watched;CHECK(watched.loadProgram("ADDI r1,r0,1\n"));CHECK(watched.setRegisterWatchpoint(1));watched.runUntilCompletion();CHECK(watched.isHalted());CHECK(watched.statistics().cycles==cycles);CHECK(watched.getState().find("\"status\":\"watchpoint\"")!=std::string::npos);
    std::string atLimit;for(int i=0;i<9994;++i)atLimit+="NOP\n";atLimit+="ADDI r1,r0,1\nloop: J loop\n";Simulator limited;CHECK(limited.loadProgram(atLimit));CHECK(limited.setRegisterWatchpoint(1));limited.runUntilCompletion();const auto state=limited.getState();CHECK(limited.statistics().cycles==10000);CHECK(state.find("\"status\":\"watchpoint\"")!=std::string::npos);CHECK(state.find("\"faulted\":false")!=std::string::npos);
  });
  test("cycle history restores atomically and replays exactly", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1\nADDI r1,r1,1\nADDI r2,r1,3\nADDI r3,r2,4\nHALT\n"));s.runCycles(9);const auto expectedState=s.getState(),expectedTimeline=s.getTimeline();CHECK(s.getHistory().find("\"currentCycle\":9")!=std::string::npos);CHECK(!s.restoreCycle(10));CHECK(s.statistics().cycles==9);CHECK(s.restoreCycle(3));CHECK(s.statistics().cycles==3);CHECK(s.getTimeline().find("\"cycle\":4,")==std::string::npos);s.runCycles(6);CHECK(s.getState()==expectedState);CHECK(s.getTimeline()==expectedTimeline);
  });
  test("history bounds distinguish rewindable and inspect-only cycles", [] {
    std::string source;for(int i=0;i<600;++i)source+="NOP\n";source+="HALT\n";Simulator s;CHECK(s.loadProgram(source));s.runCycles(510);const auto history=s.getHistory();CHECK(history.find("\"capacity\":500")!=std::string::npos);CHECK(history.find("\"oldestRewindableCycle\":10")!=std::string::npos);CHECK(!s.restoreCycle(9));CHECK(s.statistics().cycles==510);CHECK(s.restoreCycle(10));CHECK(s.statistics().cycles==10);
    Simulator bulk;CHECK(bulk.loadProgram("NOP\nHALT\n"));bulk.runUntilCompletion();const auto current=bulk.statistics().cycles;CHECK(bulk.getHistory().find("\"rewindAvailable\":false")!=std::string::npos);CHECK(!bulk.restoreCycle(current-1));CHECK(bulk.statistics().cycles==current);
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
  test("complete microarchitecture configuration is validated and serialized", [] {
    Simulator s;CHECK(s.loadProgram("HALT\n"));
    const std::string cfg="{\"forwarding\":\"none\",\"predictor\":\"one-bit\",\"predictorEntries\":64,\"cacheEnabled\":true,\"cacheCapacity\":1024,\"cacheBlockSize\":32,\"cacheAssociativity\":4,\"cacheHitLatency\":3,\"cacheMissPenalty\":21}";
    CHECK(s.validateConfigurationJson(cfg).find("\"ok\":true")!=std::string::npos);
    CHECK(s.applyConfigurationJson(cfg).find("\"ok\":true")!=std::string::npos);
    const auto state=s.getState();
    CHECK(state.find("\"forwarding\":\"none\"")!=std::string::npos);CHECK(state.find("\"predictor\":\"one-bit\"")!=std::string::npos);CHECK(state.find("\"predictorEntries\":64")!=std::string::npos);
    CHECK(state.find("\"cacheCapacity\":1024")!=std::string::npos);CHECK(state.find("\"cacheBlockSize\":32")!=std::string::npos);CHECK(state.find("\"cacheAssociativity\":4")!=std::string::npos);CHECK(state.find("\"cacheHitLatency\":3")!=std::string::npos);CHECK(state.find("\"cacheMissPenalty\":21")!=std::string::npos);
  });
  test("invalid configuration is rejected atomically with actionable errors", [] {
    Simulator s;CHECK(s.loadProgram("ADDI r1,r0,1\nHALT\n"));s.stepCycle();const auto before=s.getState();
    const std::string invalid="{\"predictorEntries\":3,\"cacheEnabled\":\"true\",\"cacheCapacity\":96,\"cacheBlockSize\":6,\"cacheAssociativity\":3,\"cacheHitLatency\":0,\"cacheMissPenalty\":0}";
    const auto validation=s.validateConfigurationJson(invalid);CHECK(validation.find("\"ok\":false")!=std::string::npos);CHECK(validation.find("power of two")!=std::string::npos);CHECK(validation.find("must be boolean")!=std::string::npos);
    const auto applied=s.applyConfigurationJson(invalid);CHECK(applied.find("\"ok\":false")!=std::string::npos);CHECK(s.getState()==before);
    CHECK(s.validateConfigurationJson("{\"predictorEntries\":\"16\"}").find("unsigned integer")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"madeUpTiming\":4}").find("Unknown processor configuration field")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"forwarding\":\"full\" trailing}").find("malformed JSON")!=std::string::npos);
  });
  test("legacy sparse configuration receives documented defaults", [] {
    Simulator s;CHECK(s.loadProgram("HALT\n"));CHECK(s.applyConfigurationJson("{\"forwarding\":\"none\",\"cacheEnabled\":true}").find("\"ok\":true")!=std::string::npos);const auto state=s.getState();
    CHECK(state.find("\"predictorEntries\":16")!=std::string::npos);CHECK(state.find("\"cacheCapacity\":256")!=std::string::npos);CHECK(state.find("\"cacheBlockSize\":16")!=std::string::npos);CHECK(state.find("\"cacheAssociativity\":2")!=std::string::npos);CHECK(state.find("\"cacheHitLatency\":1")!=std::string::npos);CHECK(state.find("\"cacheMissPenalty\":8")!=std::string::npos);
  });
  test("configured cache timing changes pipeline memory stalls", [] {
    const std::string source="LI r1,1024\nLI r2,5\nSW r2,0(r1)\nLW r3,0(r1)\nHALT\n";
    auto execute=[&](uint32_t penalty){Simulator s;CHECK(s.loadProgram(source));const auto cfg="{\"cacheEnabled\":true,\"cacheCapacity\":64,\"cacheBlockSize\":16,\"cacheAssociativity\":1,\"cacheHitLatency\":1,\"cacheMissPenalty\":"+std::to_string(penalty)+"}";CHECK(s.applyConfigurationJson(cfg).find("\"ok\":true")!=std::string::npos);s.runUntilCompletion();CHECK(s.isHalted());CHECK(s.registers()[3]==5);return s.statistics().memoryStallCycles;};
    const auto fast=execute(2),slow=execute(10);CHECK(slow>fast);CHECK(slow-fast==8);
  });
  test("configuration boundaries and malformed trailing commas are strict", [] {
    Simulator s;
    for(const auto value:{1,1024})CHECK(s.validateConfigurationJson("{\"predictorEntries\":"+std::to_string(value)+"}").find("\"ok\":true")!=std::string::npos);
    for(const auto value:{0,1025})CHECK(s.validateConfigurationJson("{\"predictorEntries\":"+std::to_string(value)+"}").find("\"ok\":false")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"cacheCapacity\":16,\"cacheBlockSize\":4,\"cacheAssociativity\":1}").find("\"ok\":true")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"cacheCapacity\":65536,\"cacheBlockSize\":256,\"cacheAssociativity\":16}").find("\"ok\":true")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"cacheCapacity\":16,\"cacheBlockSize\":16,\"cacheAssociativity\":2}").find("whole number of sets")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"cacheEnabled\":true,}").find("trailing comma")!=std::string::npos);
    CHECK(s.validateConfigurationJson("{\"x\":1,}").find("trailing comma")!=std::string::npos);
  });
  test("cache latency accounting is exact", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1024\nLW r2,0(r1)\nLW r3,0(r1)\nHALT\n"));CHECK(s.applyConfigurationJson("{\"cacheEnabled\":true,\"cacheCapacity\":64,\"cacheBlockSize\":16,\"cacheAssociativity\":1,\"cacheHitLatency\":3,\"cacheMissPenalty\":7}").find("\"ok\":true")!=std::string::npos);s.runUntilCompletion();
    CHECK(s.statistics().memoryStallCycles==11);CHECK(s.getState().find("\"stallCycles\":11")!=std::string::npos);
  });
  test("multi-way cache uses LRU and writes back dirty victims", [] {
    Configuration cfg;cfg.cacheEnabled=true;cfg.cacheCapacity=32;cfg.cacheBlockSize=8;cfg.cacheAssociativity=2;DataCache cache;cache.reset(cfg);std::vector<uint8_t> memory(128,0);
    cache.beginAccess(0,true,memory);cache.writeWord(0,0x12345678);cache.beginAccess(16,false,memory);cache.beginAccess(32,false,memory);
    CHECK(cache.stats().dirtyWritebacks==1);CHECK(memory[0]==0x78&&memory[3]==0x12);
  });
  test("predictor resizing preserves indexing and tag-based alias safety", [] {
    BranchPredictor p;p.reset(PredictorMode::TwoBit,1);p.update(0,true);p.update(0,true);CHECK(p.predict(0));CHECK(!p.predict(4));p.update(4,true);CHECK(!p.predict(0));CHECK(p.entries().size()==1);p.reset(PredictorMode::OneBit,1024);CHECK(p.entries().size()==1024);
  });
  test("write-back cache is coherent for inspection and reference comparison", [] {
    Simulator s;CHECK(s.loadProgram("LI r1,1024\nLI r2,42\nSW r2,0(r1)\nLW r3,0(r1)\nHALT\n"));CHECK(s.applyConfigurationJson("{\"cacheEnabled\":true,\"cacheCapacity\":64,\"cacheBlockSize\":16,\"cacheAssociativity\":1}").find("\"ok\":true")!=std::string::npos);s.runUntilCompletion();
    CHECK(s.memory()[1024]==0);CHECK(s.readMemory(1024,4)=="[42,0,0,0]");auto comparison=s.compareReference();CHECK(comparison.find("\"matches\":true")!=std::string::npos);CHECK(comparison.find("\"memoryDifferences\":[]")!=std::string::npos);
  });
  test("reference comparison includes initialized state and memory-only hazards", [] {
    Simulator initialized;CHECK(initialized.loadProgram("LI r1,1024\nLW r2,0(r1)\nADD r3,r2,r2\nHALT\n"));CHECK(initialized.writeMemory(1024,"7,0,0,0"));initialized.setRegister(8,99);initialized.runUntilCompletion();CHECK(initialized.registers()[3]==14);CHECK(initialized.compareReference().find("\"matches\":true")!=std::string::npos);
    Simulator manual;CHECK(manual.loadProgram("LI r1,1024\nNOP\nNOP\nNOP\nNOP\nLI r2,42\nSW r2,0(r1)\nHALT\n"));CHECK(manual.applyConfigurationJson("{\"forwarding\":\"manual\"}").find("\"ok\":true")!=std::string::npos);manual.runUntilCompletion();auto mismatch=manual.compareReference();CHECK(mismatch.find("\"differences\":[]")!=std::string::npos);CHECK(mismatch.find("\"memoryDifferences\":[{")!=std::string::npos);CHECK(mismatch.find("\"matches\":false")!=std::string::npos);
  });
  test("mid-run architectural edits explicitly disable reference comparison", [] {
    Simulator s;CHECK(s.loadProgram("ADDI r1,r0,1\nHALT\n"));s.stepCycle();s.setRegister(7,9);s.runUntilCompletion();auto result=s.compareReference();CHECK(result.find("\"comparable\":false")!=std::string::npos);CHECK(result.find("mid-run")!=std::string::npos);
  });
  test("invalid cached access faults before cache mutation", [] {
    Simulator s;CHECK(s.loadProgram("LW r1,2(r0)\nHALT\n"));CHECK(s.applyConfigurationJson("{\"cacheEnabled\":true,\"cacheMissPenalty\":1000}").find("\"ok\":true")!=std::string::npos);s.runUntilCompletion();auto state=s.getState();CHECK(state.find("\"faulted\":true")!=std::string::npos);CHECK(state.find("\"reads\":0")!=std::string::npos);CHECK(s.statistics().memoryStallCycles==0);
  });
  test("maximum cache geometry emits a bounded state preview", [] {
    Simulator s;CHECK(s.loadProgram("HALT\n"));CHECK(s.applyConfigurationJson("{\"cacheEnabled\":true,\"cacheCapacity\":65536,\"cacheBlockSize\":4,\"cacheAssociativity\":1}").find("\"ok\":true")!=std::string::npos);const auto state=s.getState();CHECK(state.find("\"totalSets\":16384")!=std::string::npos);CHECK(state.find("\"visibleSetIndices\":[0,1,2")!=std::string::npos);CHECK(state.size()<500000);
  });
  test("breakpoints survive reset and cache-miss undo replays exactly", [] {
    Simulator breakpoint;CHECK(breakpoint.loadProgram("NOP\nHALT\n"));breakpoint.setBreakpoint(4,true);breakpoint.reset();CHECK(breakpoint.getState().find("\"breakpoints\":[4]")!=std::string::npos);breakpoint.runUntilBreakpoint();CHECK(breakpoint.getState().find("\"status\":\"breakpoint\"")!=std::string::npos);
    Simulator cache;CHECK(cache.loadProgram("LI r1,1024\nLW r2,0(r1)\nHALT\n"));CHECK(cache.applyConfigurationJson("{\"cacheEnabled\":true,\"cacheMissPenalty\":8}").find("\"ok\":true")!=std::string::npos);while(cache.statistics().memoryStallCycles==0)cache.stepCycle();const auto expectedState=cache.getState(),expectedTimeline=cache.getTimeline();CHECK(cache.restorePreviousCycle());cache.stepCycle();CHECK(cache.getState()==expectedState);CHECK(cache.getTimeline()==expectedTimeline);
  });
  test("program image capacity and cycle limit fail safely", [] {
    std::string exact,overflow;for(int i=0;i<16384;++i)exact+="NOP\n";overflow=exact+"NOP\n";CHECK(Assembler{}.assemble(exact).ok());auto tooLarge=Assembler{}.assemble(overflow);CHECK(!tooLarge.ok());CHECK(tooLarge.errors.back().message.find("64 KiB")!=std::string::npos);
    Simulator loop;CHECK(loop.loadProgram("loop: J loop\n"));loop.runUntilCompletion(100000);CHECK(loop.getState().find("\"faulted\":true")!=std::string::npos);CHECK(loop.getState().find("Cycle limit reached")!=std::string::npos);CHECK(!loop.restorePreviousCycle());CHECK(loop.getTimeline().find("\"cycle\":1,")==std::string::npos);
  });
  test("bounded timeline remains deterministic across undo at capacity", [] {
    std::string source;for(int i=0;i<1100;++i)source+="NOP\n";source+="HALT\n";Simulator s;CHECK(s.loadProgram(source));s.runCycles(1001);const auto expectedState=s.getState(),expectedTimeline=s.getTimeline();CHECK(expectedTimeline.find("\"cycle\":1,")==std::string::npos);CHECK(s.restorePreviousCycle());s.stepCycle();CHECK(s.getState()==expectedState);CHECK(s.getTimeline()==expectedTimeline);
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
