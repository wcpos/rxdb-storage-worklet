#pragma once

#include <ReactCommon/TurboModule.h>
#include <memory>
#include <string>
#include <string_view>

namespace facebook::react {

class WorkletFsModule final : public TurboModule {
 public:
  static constexpr std::string_view kModuleName = "WorkletFs";
  explicit WorkletFsModule(std::shared_ptr<CallInvoker> jsInvoker);
};

#ifdef __APPLE__
std::string workletFsAppleDocumentDirectory();
#endif

} // namespace facebook::react
