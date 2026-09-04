require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name = "WorkletFs"
  s.version = package["version"]
  s.summary = "Synchronous POSIX filesystem for Worklet runtimes"
  s.homepage = "https://example.invalid/worklet-fs"
  s.license = "MIT"
  s.author = "local"
  s.platforms = { :ios => "15.1" }
  s.source = { :git => "https://example.invalid/worklet-fs.git", :tag => s.version }
  s.source_files = "apple/*.{mm,h}", "cpp/*.h"
  s.public_header_files = "cpp/*.h"
  s.header_mappings_dir = "cpp"
  s.dependency "RNWorklets"
  install_modules_dependencies(s)
  s.dependency "React-jsi"
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" => '"$(PODS_ROOT)/Headers/Public/RNWorklets"'
  }
end
