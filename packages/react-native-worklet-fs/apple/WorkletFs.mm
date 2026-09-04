#import <Foundation/Foundation.h>
#include <ReactCommon/CxxTurboModuleUtils.h>
#include "../cpp/WorkletFsModule.h"

namespace facebook::react {

std::string workletFsAppleDocumentDirectory() {
  @autoreleasepool {
    NSString *directory = [NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    return directory == nil ? std::string() : std::string(directory.UTF8String);
  }
}

} // namespace facebook::react

@interface WorkletFsRegistration : NSObject
@end

@implementation WorkletFsRegistration
+ (void)load {
  facebook::react::registerCxxModuleToGlobalModuleMap(
      "WorkletFs",
      [](auto jsInvoker) {
        return std::make_shared<facebook::react::WorkletFsModule>(jsInvoker);
      });
}
@end
