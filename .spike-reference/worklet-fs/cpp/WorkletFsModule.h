#pragma once

#include <ReactCommon/TurboModule.h>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <worklets/WorkletRuntime/WorkletRuntime.h>
#include <cerrno>
#include <cstring>
#include <string>
#include <vector>
#ifdef __APPLE__
#import <Foundation/Foundation.h>
#endif

namespace facebook::react {
namespace jsi = facebook::jsi;

[[noreturn]] inline void fail(jsi::Runtime &rt, int error, const std::string &operation) {
  const char *code = "EIO";
  switch (error) {
    case ENOENT: code = "ENOENT"; break;
    case EEXIST: code = "EEXIST"; break;
    case EBADF: code = "EBADF"; break;
    case EACCES: code = "EACCES"; break;
    case EINVAL: code = "EINVAL"; break;
    case EISDIR: code = "EISDIR"; break;
    case ENOTDIR: code = "ENOTDIR"; break;
    case ENOTEMPTY: code = "ENOTEMPTY"; break;
    case ENOSPC: code = "ENOSPC"; break;
  }
  auto errorObject = rt.global().getPropertyAsFunction(rt, "Error")
      .callAsConstructor(rt, operation + ": " + std::strerror(error)).asObject(rt);
  errorObject.setProperty(rt, "code", jsi::String::createFromAscii(rt, code));
  throw jsi::JSError(rt, jsi::Value(rt, errorObject));
}

inline std::string stringArg(jsi::Runtime &rt, const jsi::Value &value) {
  return value.asString(rt).utf8(rt);
}
inline jsi::ArrayBuffer bufferArg(jsi::Runtime &rt, const jsi::Value &value) {
  auto object = value.asObject(rt);
  if (!object.isArrayBuffer(rt)) throw jsi::JSError::createTypeError(rt, "Expected ArrayBuffer");
  return object.getArrayBuffer(rt);
}
inline void mkdirParents(jsi::Runtime &rt, const std::string &path) {
  for (size_t slash = path.find('/', 1); slash != std::string::npos; slash = path.find('/', slash + 1)) {
    auto part = path.substr(0, slash);
    if (::mkdir(part.c_str(), 0700) && errno != EEXIST) fail(rt, errno, "mkdir");
  }
}
inline void removePath(jsi::Runtime &rt, const std::string &path, bool recursive) {
  struct stat info {};
  if (::lstat(path.c_str(), &info)) fail(rt, errno, "stat");
  if (S_ISDIR(info.st_mode)) {
    if (recursive) {
      DIR *dir = ::opendir(path.c_str());
      if (!dir) fail(rt, errno, "opendir");
      while (auto *entry = ::readdir(dir)) {
        std::string name(entry->d_name);
        if (name != "." && name != "..") removePath(rt, path + "/" + name, true);
      }
      ::closedir(dir);
    }
    if (::rmdir(path.c_str())) fail(rt, errno, "rmdir");
  } else if (::unlink(path.c_str())) fail(rt, errno, "unlink");
}
inline std::string documentDirectory() {
#ifdef __APPLE__
  @autoreleasepool {
    return [[NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject] UTF8String];
  }
#else
  if (const char *home = std::getenv("HOME")) return home;
  char process[256] = {};
  int fd = ::open("/proc/self/cmdline", O_RDONLY);
  if (fd >= 0) { ::read(fd, process, sizeof(process) - 1); ::close(fd); }
  return std::string("/data/user/0/") + process + "/files";
#endif
}

class FsHost final : public jsi::HostObject {
 public:
  jsi::Value get(jsi::Runtime &rt, const jsi::PropNameID &property) override {
    const auto name = property.utf8(rt);
    auto function = [&](unsigned count, auto body) -> jsi::Value {
      return jsi::Function::createFromHostFunction(rt, property, count, body);
    };
    if (name == "open") return function(2, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      auto path = stringArg(rt, a[0]); auto mode = stringArg(rt, a[1]); int flags;
      if (mode == "r") flags = O_RDONLY; else if (mode == "rw") flags = O_RDWR;
      else if (mode == "create") { flags = O_RDWR | O_CREAT; mkdirParents(rt, path); }
      else throw jsi::JSError::createTypeError(rt, "Invalid open mode");
      int fd = ::open(path.c_str(), flags, 0600); if (fd < 0) fail(rt, errno, "open"); return jsi::Value(fd);
    });
    if (name == "readAt") return function(4, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      auto b = bufferArg(rt, a[1]); size_t length = static_cast<size_t>(a[3].asNumber());
      if (length > b.size(rt)) throw jsi::JSError::createRangeError(rt, "Read exceeds buffer");
      auto n = ::pread(a[0].asNumber(), b.data(rt), length, a[2].asNumber());
      if (n < 0) fail(rt, errno, "pread"); return jsi::Value(static_cast<double>(n));
    });
    if (name == "writeAt") return function(3, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      auto b = bufferArg(rt, a[1]); auto n = ::pwrite(a[0].asNumber(), b.data(rt), b.size(rt), a[2].asNumber());
      if (n < 0) fail(rt, errno, "pwrite"); return jsi::Value(static_cast<double>(n));
    });
    if (name == "truncate") return function(2, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      if (::ftruncate(a[0].asNumber(), a[1].asNumber())) fail(rt, errno, "ftruncate"); return jsi::Value::undefined();
    });
    if (name == "size") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      struct stat info {}; if (::fstat(a[0].asNumber(), &info)) fail(rt, errno, "fstat"); return jsi::Value(static_cast<double>(info.st_size));
    });
    if (name == "flush") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      if (::fsync(a[0].asNumber())) fail(rt, errno, "fsync"); return jsi::Value::undefined();
    });
    if (name == "close") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      if (::close(a[0].asNumber())) fail(rt, errno, "close"); return jsi::Value::undefined();
    });
    if (name == "mkdir") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      if (::mkdir(stringArg(rt, a[0]).c_str(), 0700)) fail(rt, errno, "mkdir"); return jsi::Value::undefined();
    });
    if (name == "readdir") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      auto path = stringArg(rt, a[0]); DIR *dir = ::opendir(path.c_str()); if (!dir) fail(rt, errno, "opendir");
      std::vector<std::pair<std::string, bool>> entries;
      while (auto *entry = ::readdir(dir)) { std::string child(entry->d_name); if (child == "." || child == "..") continue;
        struct stat info {}; bool isDir = entry->d_type == DT_DIR || (entry->d_type == DT_UNKNOWN && !::stat((path + "/" + child).c_str(), &info) && S_ISDIR(info.st_mode));
        entries.emplace_back(child, isDir);
      }
      ::closedir(dir); jsi::Array result(rt, entries.size());
      for (size_t i = 0; i < entries.size(); ++i) { jsi::Object item(rt); item.setProperty(rt, "name", entries[i].first); item.setProperty(rt, "kind", entries[i].second ? "dir" : "file"); result.setValueAtIndex(rt, i, std::move(item)); }
      return result;
    });
    if (name == "remove") return function(2, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      removePath(rt, stringArg(rt, a[0]), a[1].getBool()); return jsi::Value::undefined();
    });
    if (name == "exists") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
      struct stat info {}; if (::lstat(stringArg(rt, a[0]).c_str(), &info)) { if (errno == ENOENT) return jsi::Value::null(); fail(rt, errno, "stat"); }
      return jsi::String::createFromAscii(rt, S_ISDIR(info.st_mode) ? "dir" : "file");
    });
    if (name == "documentDirectory") return function(0, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *, size_t) { return jsi::String::createFromUtf8(rt, documentDirectory()); });
    if (name == "utf8Decode") return function(3, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      auto b = bufferArg(rt, a[0]); size_t start = a[1].asNumber(), end = a[2].asNumber();
      if (start > end || end > b.size(rt)) throw jsi::JSError::createRangeError(rt, "Invalid UTF-8 range");
      return jsi::String::createFromUtf8(rt, b.data(rt) + start, end - start);
    });
    if (name == "utf8Encode") return function(1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t) {
      auto text = stringArg(rt, a[0]); auto result = rt.global().getPropertyAsFunction(rt, "ArrayBuffer").callAsConstructor(rt, static_cast<double>(text.size())).asObject(rt).getArrayBuffer(rt);
      std::memcpy(result.data(rt), text.data(), text.size()); return result;
    });
    return jsi::Value::undefined();
  }
};

inline void install(jsi::Runtime &rt) {
  rt.global().setProperty(rt, "__workletFs", jsi::Object::createFromHostObject(rt, std::make_shared<FsHost>()));
}

class WorkletFsModule final : public TurboModule {
 public:
  static constexpr std::string_view kModuleName = "WorkletFs";
  explicit WorkletFsModule(std::shared_ptr<CallInvoker> invoker) : TurboModule("WorkletFs", std::move(invoker)) {
    methodMap_["install"] = MethodMetadata{1, [](jsi::Runtime &rt, TurboModule &, const jsi::Value *args, size_t count) {
      if (count && !args[0].isUndefined() && !args[0].isNull()) install(worklets::extractWorkletRuntime(rt, args[0])->getJSIRuntime());
      else install(rt);
      return jsi::Value::undefined();
    }};
  }
};
} // namespace facebook::react
