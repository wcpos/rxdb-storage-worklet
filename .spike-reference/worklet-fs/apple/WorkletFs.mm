#import <Foundation/Foundation.h>
#include <ReactCommon/CxxTurboModuleUtils.h>
#include "../cpp/WorkletFsModule.h"

@interface WorkletFsRegistration : NSObject @end
@implementation WorkletFsRegistration
+ (void)load {
  facebook::react::registerCxxModuleToGlobalModuleMap(
      "WorkletFs", [](auto invoker) { return std::make_shared<facebook::react::WorkletFsModule>(invoker); });
}
@end
