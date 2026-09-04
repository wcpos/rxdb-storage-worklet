cmake_minimum_required(VERSION 3.16)
project(worklet_fs)

set(CMAKE_CXX_STANDARD 20)
add_library(worklet_fs STATIC WorkletFsModule.cpp)
target_compile_features(worklet_fs PUBLIC cxx_std_20)
target_include_directories(worklet_fs PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")

find_package(ReactAndroid REQUIRED CONFIG)
find_package(react-native-worklets REQUIRED CONFIG)
target_link_libraries(
  worklet_fs
  ReactAndroid::reactnative
  ReactAndroid::jsi
  react-native-worklets::worklets
)
