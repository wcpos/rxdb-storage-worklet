require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name = "WorkletFs"
  s.version = package["version"]
  s.summary = "Synchronous POSIX filesystem primitives for Worklet runtimes"
  s.homepage = "https://github.com/wcpos/rxdb-storage-worklet"
  s.license = "MIT"
  s.author = "WCPOS"
  s.platforms = { :ios => "15.1" }
  s.source = { :git => "https://github.com/wcpos/rxdb-storage-worklet.git", :tag => s.version }
  s.source_files = "apple/*.{mm,h}", "cpp/*.{cpp,h}"
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
