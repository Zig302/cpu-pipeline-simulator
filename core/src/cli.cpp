#include "cpulab/core.hpp"

#include <fstream>
#include <iostream>
#include <sstream>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: cpulab_cli <program.asm>\n";
    return 2;
  }
  std::ifstream file(argv[1]);
  std::ostringstream source;
  source << file.rdbuf();
  cpulab::Simulator simulator;
  if (!simulator.loadProgram(source.str())) {
    std::cerr << simulator.assemble(source.str()) << '\n';
    return 1;
  }
  simulator.runUntilCompletion();
  std::cout << simulator.getState() << '\n';
  return simulator.isHalted() ? 0 : 1;
}

