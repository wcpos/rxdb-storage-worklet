#include "WorkletFsModule.h"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <worklets/WorkletRuntime/WorkletRuntime.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <limits>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace facebook::react {
namespace jsi = facebook::jsi;

[[noreturn]] void fail(
    jsi::Runtime &runtime,
    int error,
    const std::string &operation) {
  const char *code = "EIO";
  switch (error) {
    case ENOENT:
      code = "ENOENT";
      break;
    case EEXIST:
      code = "EEXIST";
      break;
    case EBADF:
      code = "EBADF";
      break;
    case EACCES:
      code = "EACCES";
      break;
    case EINVAL:
      code = "EINVAL";
      break;
    case EISDIR:
      code = "EISDIR";
      break;
    case ENOTDIR:
      code = "ENOTDIR";
      break;
    case ENOTEMPTY:
      code = "ENOTEMPTY";
      break;
    case ENOSPC:
      code = "ENOSPC";
      break;
  }
  auto errorObject = runtime.global()
                         .getPropertyAsFunction(runtime, "Error")
                         .callAsConstructor(
                             runtime,
                             operation + ": " + std::strerror(error))
                         .asObject(runtime);
  errorObject.setProperty(
      runtime, "code", jsi::String::createFromAscii(runtime, code));
  throw jsi::JSError(runtime, jsi::Value(runtime, errorObject));
}

std::string stringArg(jsi::Runtime &runtime, const jsi::Value &value) {
  if (!value.isString()) throw jsi::JSError::createTypeError(runtime, "Expected string");
  return value.asString(runtime).utf8(runtime);
}

std::string pathArg(jsi::Runtime &runtime, const jsi::Value &value) {
  auto path = stringArg(runtime, value);
  if (path.find('\0') != std::string::npos) {
    throw jsi::JSError::createTypeError(runtime, "Expected path without NUL");
  }
  return path;
}

// Restrict positions to exact JS integers as well as the destination's range.
constexpr double maxSafeInteger = 9007199254740991.0;
const double maxFilePosition = std::min(maxSafeInteger, static_cast<double>(std::numeric_limits<off_t>::max()));
double integerArg(jsi::Runtime &runtime, const jsi::Value &value, double max = maxSafeInteger) {
  if (!value.isNumber()) throw jsi::JSError::createTypeError(runtime, "Expected number");
  const double number = value.asNumber();
  if (!std::isfinite(number) || number < 0 || std::floor(number) != number || number > max) {
    throw jsi::JSError::createRangeError(runtime, "Invalid integer range");
  }
  return number;
}

int fdArg(jsi::Runtime &runtime, const jsi::Value &value) {
  return static_cast<int>(integerArg(runtime, value, std::numeric_limits<int>::max()));
}

jsi::ArrayBuffer bufferArg(jsi::Runtime &runtime, const jsi::Value &value) {
  if (!value.isObject()) throw jsi::JSError::createTypeError(runtime, "Expected ArrayBuffer");
  auto object = value.asObject(runtime);
  if (!object.isArrayBuffer(runtime)) {
    throw jsi::JSError::createTypeError(runtime, "Expected ArrayBuffer");
  }
  return object.getArrayBuffer(runtime);
}

void mkdirParents(jsi::Runtime &runtime, const std::string &path) {
  for (size_t slash = path.find('/', 1); slash != std::string::npos;
       slash = path.find('/', slash + 1)) {
    const auto parent = path.substr(0, slash);
    if (::mkdir(parent.c_str(), 0700) != 0 && errno != EEXIST) {
      fail(runtime, errno, "mkdir");
    }
  }
}

std::vector<std::string> directoryEntries(
    jsi::Runtime &runtime,
    const std::string &path) {
  DIR *directory = ::opendir(path.c_str());
  if (directory == nullptr) {
    fail(runtime, errno, "opendir");
  }
  std::vector<std::string> entries;
  errno = 0;
  while (auto *entry = ::readdir(directory)) {
    std::string name(entry->d_name);
    if (name != "." && name != "..") {
      entries.push_back(std::move(name));
    }
    errno = 0;
  }
  const int readError = errno;
  ::closedir(directory);
  if (readError != 0) {
    fail(runtime, readError, "readdir");
  }
  return entries;
}

void removePath(
    jsi::Runtime &runtime,
    const std::string &path,
    bool recursive) {
  struct stat info {};
  if (::lstat(path.c_str(), &info) != 0) {
    fail(runtime, errno, "stat");
  }
  if (!S_ISDIR(info.st_mode)) {
    if (::unlink(path.c_str()) != 0) {
      fail(runtime, errno, "unlink");
    }
    return;
  }
  if (recursive) {
    for (const auto &name : directoryEntries(runtime, path)) {
      removePath(runtime, path + "/" + name, true);
    }
  }
  if (::rmdir(path.c_str()) != 0) {
    fail(runtime, errno, "rmdir");
  }
}

std::string documentDirectory() {
#ifdef __APPLE__
  return workletFsAppleDocumentDirectory();
#else
  return {};
#endif
}

void defineFunction(
    jsi::Runtime &runtime,
    jsi::Object &object,
    const char *name,
    unsigned int parameterCount,
    jsi::HostFunctionType function) {
  auto property = jsi::PropNameID::forAscii(runtime, name);
  object.setProperty(
      runtime,
      property,
      jsi::Function::createFromHostFunction(
          runtime, property, parameterCount,
          [parameterCount, function = std::move(function)](jsi::Runtime &rt, const jsi::Value &self, const jsi::Value *args, size_t count) {
            if (count < parameterCount) throw jsi::JSError::createTypeError(rt, "Missing arguments");
            return function(rt, self, args, count);
          }));
}

void installWorkletFs(jsi::Runtime &runtime) {
  jsi::Object fs(runtime);

  defineFunction(runtime, fs, "open", 2, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    const auto path = pathArg(runtime, args[0]);
    const auto mode = stringArg(runtime, args[1]);
    int flags = 0;
    if (mode == "r") {
      flags = O_RDONLY;
    } else if (mode == "rw") {
      flags = O_RDWR;
    } else if (mode == "create") {
      flags = O_RDWR | O_CREAT;
      mkdirParents(runtime, path);
    } else {
      throw jsi::JSError::createTypeError(runtime, "Invalid open mode");
    }
    const int fd = ::open(path.c_str(), flags, 0600);
    if (fd < 0) fail(runtime, errno, "open");
    return jsi::Value(fd);
  });

  defineFunction(runtime, fs, "readAt", 4, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    auto buffer = bufferArg(runtime, args[1]);
    const int fd = fdArg(runtime, args[0]);
    const auto length = static_cast<size_t>(integerArg(runtime, args[3], buffer.size(runtime)));
    const auto at = static_cast<off_t>(integerArg(runtime, args[2], maxFilePosition - length));
    size_t total = 0;
    while (total < length) {
      const auto count = ::pread(fd, buffer.data(runtime) + total, length - total, at + total);
      if (count < 0) fail(runtime, errno, "pread");
      if (count == 0) break; // EOF
      total += static_cast<size_t>(count);
    }
    return jsi::Value(static_cast<double>(total));
  });

  defineFunction(runtime, fs, "writeAt", 3, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    auto buffer = bufferArg(runtime, args[1]);
    const int fd = fdArg(runtime, args[0]);
    const auto length = buffer.size(runtime);
    const auto at = static_cast<off_t>(integerArg(runtime, args[2], maxFilePosition - length));
    size_t total = 0;
    while (total < length) {
      const auto count = ::pwrite(fd, buffer.data(runtime) + total, length - total, at + total);
      if (count < 0) fail(runtime, errno, "pwrite");
      if (count == 0) fail(runtime, EIO, "pwrite made no progress");
      total += static_cast<size_t>(count);
    }
    return jsi::Value(static_cast<double>(total));
  });

  defineFunction(runtime, fs, "truncate", 2, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    if (::ftruncate(
            fdArg(runtime, args[0]),
            static_cast<off_t>(integerArg(runtime, args[1], maxFilePosition))) != 0) {
      fail(runtime, errno, "ftruncate");
    }
    return jsi::Value::undefined();
  });

  defineFunction(runtime, fs, "size", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    struct stat info {};
    if (::fstat(fdArg(runtime, args[0]), &info) != 0) {
      fail(runtime, errno, "fstat");
    }
    return jsi::Value(static_cast<double>(info.st_size));
  });

  defineFunction(runtime, fs, "flush", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    if (::fsync(fdArg(runtime, args[0])) != 0) {
      fail(runtime, errno, "fsync");
    }
    return jsi::Value::undefined();
  });

  defineFunction(runtime, fs, "close", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    if (::close(fdArg(runtime, args[0])) != 0) {
      fail(runtime, errno, "close");
    }
    return jsi::Value::undefined();
  });

  defineFunction(runtime, fs, "mkdir", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    if (::mkdir(pathArg(runtime, args[0]).c_str(), 0700) != 0) {
      fail(runtime, errno, "mkdir");
    }
    return jsi::Value::undefined();
  });

  defineFunction(runtime, fs, "readdir", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    const auto path = pathArg(runtime, args[0]);
    const auto names = directoryEntries(runtime, path);
    jsi::Array result(runtime, names.size());
    for (size_t index = 0; index < names.size(); ++index) {
      struct stat info {};
      const auto childPath = path + "/" + names[index];
      if (::lstat(childPath.c_str(), &info) != 0) {
        fail(runtime, errno, "stat");
      }
      jsi::Object item(runtime);
      item.setProperty(runtime, "name", names[index]);
      item.setProperty(runtime, "kind", S_ISDIR(info.st_mode) ? "dir" : "file");
      result.setValueAtIndex(runtime, index, std::move(item));
    }
    return result;
  });

  defineFunction(runtime, fs, "remove", 2, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    if (!args[1].isBool()) throw jsi::JSError::createTypeError(runtime, "Expected boolean");
    removePath(runtime, pathArg(runtime, args[0]), args[1].getBool());
    return jsi::Value::undefined();
  });

  defineFunction(runtime, fs, "exists", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) -> jsi::Value {
    struct stat info {};
    if (::lstat(pathArg(runtime, args[0]).c_str(), &info) != 0) {
      if (errno == ENOENT) return jsi::Value::null();
      fail(runtime, errno, "stat");
    }
    return jsi::String::createFromAscii(
        runtime, S_ISDIR(info.st_mode) ? "dir" : "file");
  });

  defineFunction(runtime, fs, "documentDirectory", 0, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *, size_t) {
    return jsi::String::createFromUtf8(runtime, documentDirectory());
  });

  defineFunction(runtime, fs, "utf8Decode", 3, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    auto buffer = bufferArg(runtime, args[0]);
    const auto start = static_cast<size_t>(integerArg(runtime, args[1], buffer.size(runtime)));
    const auto end = static_cast<size_t>(integerArg(runtime, args[2], buffer.size(runtime)));
    if (start > end || end > buffer.size(runtime)) {
      throw jsi::JSError::createRangeError(runtime, "Invalid UTF-8 range");
    }
    return jsi::String::createFromUtf8(
        runtime, buffer.data(runtime) + start, end - start);
  });

  defineFunction(runtime, fs, "utf8Encode", 1, [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) {
    const auto text = stringArg(runtime, args[0]);
    auto result = runtime.global()
                      .getPropertyAsFunction(runtime, "ArrayBuffer")
                      .callAsConstructor(runtime, static_cast<double>(text.size()))
                      .asObject(runtime)
                      .getArrayBuffer(runtime);
    std::memcpy(result.data(runtime), text.data(), text.size());
    return result;
  });

  runtime.global().setProperty(runtime, "__workletFs", std::move(fs));
}

WorkletFsModule::WorkletFsModule(std::shared_ptr<CallInvoker> jsInvoker)
    : TurboModule("WorkletFs", std::move(jsInvoker)) {
  methodMap_["install"] = MethodMetadata{
      1,
      [](jsi::Runtime &runtime,
         TurboModule &,
         const jsi::Value *args,
         size_t count) {
        if (count == 0 || args[0].isUndefined() || args[0].isNull()) {
          installWorkletFs(runtime);
        } else {
          auto workletRuntime = worklets::extractWorkletRuntime(runtime, args[0]);
          workletRuntime->runSync(std::function<void(jsi::Runtime &)>(
              [](jsi::Runtime &targetRuntime) {
                installWorkletFs(targetRuntime);
              }));
        }
        return jsi::Value::undefined();
      }};
}

} // namespace facebook::react
