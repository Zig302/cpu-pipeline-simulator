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
    .function("stepCycle", &cpulab::Simulator::stepCycle)
    .function("stepInstruction", &cpulab::Simulator::stepInstruction)
    .function("runCycles", &cpulab::Simulator::runCycles)
    .function("runUntilCompletion", &cpulab::Simulator::runUntilCompletion)
    .function("runUntilBreakpoint", &cpulab::Simulator::runUntilBreakpoint)
    .function("getState", &cpulab::Simulator::getState)
    .function("getEvents", &cpulab::Simulator::getEvents)
    .function("getTimeline", &cpulab::Simulator::getTimeline)
    .function("setBreakpoint", &cpulab::Simulator::setBreakpoint)
    .function("setRegister", &cpulab::Simulator::setRegister)
    .function("readMemory", &cpulab::Simulator::readMemory)
    .function("writeMemory", &cpulab::Simulator::writeMemory)
    .function("restorePreviousCycle", &cpulab::Simulator::restorePreviousCycle)
    .function("isHalted", &cpulab::Simulator::isHalted);
}
#endif

