#include "cpulab/core.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>

EMSCRIPTEN_BINDINGS(cpulab_module) {
  using namespace emscripten;
  class_<cpulab::Simulator>("Simulator")
    .constructor<>()
    .function("assemble", &cpulab::Simulator::assemble)
    .function("loadProgram", &cpulab::Simulator::loadProgram)
    .function("reset", &cpulab::Simulator::reset)
    .function("resetWithJson", &cpulab::Simulator::resetWithJson)
    .function("validateConfigurationJson", &cpulab::Simulator::validateConfigurationJson)
    .function("applyConfigurationJson", &cpulab::Simulator::applyConfigurationJson)
    .function("stepCycle", &cpulab::Simulator::stepCycle)
    .function("stepInstruction", &cpulab::Simulator::stepInstruction)
    .function("runCycles", &cpulab::Simulator::runCycles)
    .function("runUntilCompletion", &cpulab::Simulator::runUntilCompletion)
    .function("runUntilBreakpoint", &cpulab::Simulator::runUntilBreakpoint)
    .function("getState", &cpulab::Simulator::getState)
    .function("getEvents", &cpulab::Simulator::getEvents)
    .function("getTimeline", &cpulab::Simulator::getTimeline)
    .function("getHistory", &cpulab::Simulator::getHistory)
    .function("compareReference", &cpulab::Simulator::compareReference)
    .function("getInitialState", &cpulab::Simulator::getInitialState)
    .function("setBreakpoint", &cpulab::Simulator::setBreakpoint)
    .function("setRegisterWatchpoint", &cpulab::Simulator::setRegisterWatchpoint)
    .function("setMemoryWatchpoint", &cpulab::Simulator::setMemoryWatchpoint)
    .function("setRegister", &cpulab::Simulator::setRegister)
    .function("readMemory", &cpulab::Simulator::readMemory)
    .function("writeMemory", &cpulab::Simulator::writeMemory)
    .function("restorePreviousCycle", &cpulab::Simulator::restorePreviousCycle)
    .function("restoreCycle", &cpulab::Simulator::restoreCycle)
    .function("isHalted", &cpulab::Simulator::isHalted);
}
#endif
