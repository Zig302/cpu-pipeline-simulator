cmake_minimum_required(VERSION 3.20)
project(CpuPipelineLab VERSION 1.3.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(CPULAB_BUILD_TESTS "Build native core tests" ON)
option(CPULAB_BUILD_WASM "Build the Emscripten browser module" OFF)

add_library(cpulab_core core/src/core.cpp)
target_include_directories(cpulab_core PUBLIC core/include)
target_compile_options(cpulab_core PRIVATE
  $<$<CXX_COMPILER_ID:MSVC>:/W4 /permissive->
  $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-Wall -Wextra -Wpedantic>)

if(NOT EMSCRIPTEN)
  add_executable(cpulab_cli core/src/cli.cpp)
  target_link_libraries(cpulab_cli PRIVATE cpulab_core)
endif()

if(CPULAB_BUILD_TESTS)
  enable_testing()
  add_executable(cpulab_tests core/tests/tests.cpp)
  target_link_libraries(cpulab_tests PRIVATE cpulab_core)
  add_test(NAME cpulab_tests COMMAND cpulab_tests)
endif()

if(EMSCRIPTEN OR CPULAB_BUILD_WASM)
  add_executable(cpu_core_wasm core/src/bindings.cpp)
  target_link_libraries(cpu_core_wasm PRIVATE cpulab_core)
  set_target_properties(cpu_core_wasm PROPERTIES
    OUTPUT_NAME "cpu_core"
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/wasm-artifact")
  target_link_options(cpu_core_wasm PRIVATE
    "--bind"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createCpuLab"
    "-sALLOW_MEMORY_GROWTH=0"
    "-sINITIAL_MEMORY=134217728"
    "-sENVIRONMENT=web"
    "-sFILESYSTEM=0")
endif()
