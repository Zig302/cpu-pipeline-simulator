#pragma once

#include <array>
#include <cstdint>
#include <deque>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace cpulab {

enum class Op : uint8_t {
  NOP = 0, ADD, SUB, MUL, ADDI, AND, OR, XOR, SLL, SRL, SLT,
  LW, SW, BEQ, BNE, BLT, J, JAL, JR, LUI, HALT, INVALID = 63
};

enum class ForwardingMode { None, Full, Manual };
enum class PredictorMode { AlwaysNotTaken, AlwaysTaken, OneBit, TwoBit };

struct Decoded {
  Op op{Op::INVALID};
  uint8_t rd{0}, rs1{0}, rs2{0};
  int32_t imm{0};
  bool usesRs1{false}, usesRs2{false}, writesRd{false};
  bool isLoad{false}, isStore{false}, isBranch{false}, isJump{false};
};

std::string opName(Op op);
uint32_t encodeR(Op op, uint8_t rd, uint8_t rs1, uint8_t rs2);
uint32_t encodeI(Op op, uint8_t rd, uint8_t rs1, int32_t imm);
uint32_t encodeB(Op op, uint8_t rs1, uint8_t rs2, int32_t wordOffset);
uint32_t encodeJ(Op op, uint8_t rd, int32_t wordOffset);
Decoded decode(uint32_t word);

struct AssemblyError { int line{0}; int column{1}; std::string message; };
struct Program {
  std::vector<uint32_t> words;
  std::vector<std::string> assembly;
  std::vector<int> sourceLines;
  std::unordered_map<std::string, uint32_t> labels;
  std::vector<AssemblyError> errors;
  bool ok() const { return errors.empty(); }
};

class Assembler {
 public:
  Program assemble(const std::string& source) const;
};

struct Configuration {
  ForwardingMode forwarding{ForwardingMode::Full};
  PredictorMode predictor{PredictorMode::TwoBit};
  uint32_t predictorEntries{16};
  uint32_t memoryBytes{65536};
  uint32_t initialStackPointer{0xfffc};
  uint64_t cycleLimit{10000};
  bool cacheEnabled{false};
  uint32_t cacheCapacity{256};
  uint32_t cacheBlockSize{16};
  uint32_t cacheAssociativity{2};
  uint32_t cacheHitLatency{1};
  uint32_t cacheMissPenalty{8};
};

struct Event {
  Event() = default;
  Event(std::string eventType, uint64_t eventCycle, std::string eventStage,
        std::vector<uint64_t> ids, int eventReg, std::string eventSource,
        std::string eventMessage)
      : type(std::move(eventType)), cycle(eventCycle), stage(std::move(eventStage)),
        instructionIds(std::move(ids)), reg(eventReg), source(std::move(eventSource)),
        message(std::move(eventMessage)) {}
  std::string type;
  uint64_t cycle{0};
  std::string stage;
  std::vector<uint64_t> instructionIds;
  int reg{-1};
  std::string source;
  std::string message;
  std::string watchpointKind;
  std::string access;
  int64_t address{-1};
  uint32_t oldValue{0};
  uint32_t newValue{0};
};

struct PipelineSlot {
  bool valid{false};
  bool stalled{false};
  bool squashed{false};
  bool bubble{false};
  uint64_t id{0};
  uint32_t raw{0};
  uint32_t pc{0};
  Decoded decoded{};
  std::string assembly;
  int sourceLine{0};
  uint32_t rs1Value{0}, rs2Value{0};
  uint32_t operandA{0}, operandB{0};
  uint32_t aluResult{0};
  uint32_t memoryAddress{0}, memoryData{0};
  uint32_t writeValue{0};
  bool regWrite{false}, memRead{false}, memWrite{false};
  bool predictedTaken{false}, actualTaken{false};
  uint32_t predictedTarget{0}, actualTarget{0};
  bool mispredicted{false};
};

struct Statistics {
  uint64_t cycles{0}, fetched{0}, retired{0};
  uint64_t stallCycles{0}, dataStallCycles{0}, memoryStallCycles{0};
  uint64_t controlPenalty{0}, forwardingEvents{0}, flushedInstructions{0};
  uint64_t branches{0}, correctPredictions{0}, mispredictions{0};
  uint64_t registerWrites{0}, memoryWrites{0};
};

struct PredictorEntry { uint32_t tagPc{0}; uint8_t state{1}; bool valid{false}; bool recentTaken{false}; };

class BranchPredictor {
 public:
  void reset(PredictorMode mode, uint32_t entries);
  bool predict(uint32_t pc) const;
  uint8_t state(uint32_t pc) const;
  std::pair<uint8_t,uint8_t> update(uint32_t pc, bool taken);
  const std::vector<PredictorEntry>& entries() const { return table_; }
 private:
  PredictorMode mode_{PredictorMode::TwoBit};
  std::vector<PredictorEntry> table_;
};

struct CacheLine {
  bool valid{false}, dirty{false};
  uint32_t tag{0};
  uint64_t lru{0};
  std::vector<uint8_t> data;
};
struct CacheStats { uint64_t reads{0}, writes{0}, hits{0}, misses{0}, dirtyWritebacks{0}, stallCycles{0}; };

class DataCache {
 public:
  void reset(const Configuration& cfg);
  uint32_t beginAccess(uint32_t address, bool write, std::vector<uint8_t>& memory);
  uint32_t readWord(uint32_t address) const;
  void writeWord(uint32_t address, uint32_t value);
  void patchByte(uint32_t address, uint8_t value);
  uint8_t inspectByte(uint32_t address, const std::vector<uint8_t>& memory) const;
  void overlayMemory(std::vector<uint8_t>& memory) const;
  const std::vector<std::vector<CacheLine>>& sets() const { return sets_; }
  const CacheStats& stats() const { return stats_; }
 private:
  Configuration cfg_{};
  std::vector<std::vector<CacheLine>> sets_;
  CacheStats stats_{};
  uint64_t tick_{0};
  CacheLine* find(uint32_t address);
};

class Simulator {
 public:
  Simulator();
  std::string assemble(const std::string& source);
  bool loadProgram(const std::string& source);
  void reset();
  void resetWithJson(const std::string& json);
  std::string validateConfigurationJson(const std::string& json) const;
  std::string applyConfigurationJson(const std::string& json);
  std::string stepCycle();
  std::string stepInstruction();
  std::string runCycles(uint32_t count);
  std::string runUntilCompletion(uint32_t maxCycles = 100000);
  std::string runUntilBreakpoint(uint32_t maxCycles = 100000);
  std::string getState() const;
  std::string getEvents() const;
  std::string getTimeline() const;
  std::string getHistory() const;
  std::string compareReference() const;
  std::string getInitialState() const;
  void setBreakpoint(uint32_t address, bool enabled = true);
  bool setRegisterWatchpoint(uint32_t index, bool enabled = true);
  bool setMemoryWatchpoint(uint32_t address, bool enabled = true);
  void setRegister(uint32_t index, uint32_t value);
  std::string readMemory(uint32_t address, uint32_t length) const;
  bool writeMemory(uint32_t address, const std::string& csvBytes);
  bool restorePreviousCycle();
  bool restoreCycle(uint64_t cycle);
  bool isHalted() const { return halted_; }
  const std::array<uint32_t,32>& registers() const { return regs_; }
  const std::vector<uint8_t>& memory() const { return memory_; }
  const Statistics& statistics() const { return stats_; }
  const Program& program() const { return program_; }

 private:
  struct TimelineFrame { uint64_t cycle{0}; std::array<PipelineSlot,6> slots; std::vector<Event> events; };
  struct Snapshot {
    std::array<uint32_t,32> regs{};
    std::vector<uint8_t> memory;
    std::array<uint32_t,32> initialRegs{};
    std::vector<uint8_t> initialMemory;
    uint32_t pc{0}; uint64_t nextId{1};
    PipelineSlot ifid,idex,exmem1,mem1mem2,mem2wb;
    Statistics stats{}; BranchPredictor predictor; DataCache cache;
    bool halted{false}, fetchStopped{false}, faulted{false}, watchpointHit{false};
    bool referenceComparable{true};
    std::string status; uint32_t memWait{0}; bool memAccessStarted{false};
    size_t timelineSize{0};
    bool droppedTimelineFrame{false}; TimelineFrame droppedFrame{};
  };

  Configuration cfg_{};
  Program program_{};
  std::string source_;
  std::array<uint32_t,32> regs_{};
  std::vector<uint8_t> memory_;
  std::array<uint32_t,32> initialRegs_{};
  std::vector<uint8_t> initialMemory_;
  uint32_t pc_{0}; uint64_t nextId_{1};
  PipelineSlot ifid_{},idex_{},exmem1_{},mem1mem2_{},mem2wb_{};
  Statistics stats_{}; BranchPredictor predictor_{}; DataCache cache_{};
  bool halted_{false}, fetchStopped_{false}, faulted_{false};
  bool watchpointHit_{false};
  bool referenceComparable_{true};
  std::string status_{"ready"};
  uint32_t memWait_{0}; bool memAccessStarted_{false};
  std::vector<Event> events_;
  std::deque<TimelineFrame> timeline_;
  std::deque<Snapshot> history_;
  std::set<uint32_t> breakpoints_;
  std::set<uint32_t> registerWatchpoints_;
  std::set<uint32_t> memoryWatchpoints_;
  bool batchRunning_{false};
  bool skipSnapshots_{false};

  void snapshot();
  uint32_t loadWord(uint32_t address);
  void storeWord(uint32_t address, uint32_t value);
  void fault(const std::string& message, const std::string& stage, uint64_t id);
  bool pipelineEmpty() const;
  uint32_t forwardedValue(uint8_t reg, uint32_t original, const std::string& operand, uint64_t consumerId);
  bool shouldStall(const Decoded& d, std::string& reason, uint8_t& reg, uint64_t& producer) const;
  PipelineSlot fetchSlot(uint32_t address);
  PipelineSlot execute(const PipelineSlot& in, bool& redirect, uint32_t& target);
  std::string slotJson(const PipelineSlot& slot, const std::string& stage) const;
  std::vector<uint8_t> coherentMemory() const;
};

struct ReferenceResult {
  std::array<uint32_t,32> registers{};
  std::vector<uint8_t> memory;
  uint32_t pc{0}; bool halted{false}; std::string error; uint64_t steps{0};
};

class ReferenceInterpreter {
 public:
  ReferenceResult run(const Program& program, const Configuration& cfg = {}, uint64_t maxSteps = 100000) const;
  ReferenceResult runWithInitialState(const Program& program, const Configuration& cfg, uint64_t maxSteps,
                                      const std::array<uint32_t,32>& initialRegisters,
                                      const std::vector<uint8_t>& initialMemory) const;
};

}  // namespace cpulab
