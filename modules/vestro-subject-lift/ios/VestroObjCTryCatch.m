#import "VestroObjCTryCatch.h"

BOOL VestroTryCatch(void (NS_NOESCAPE ^tryBlock)(void), NSError * _Nullable * _Nullable outError) {
  @try {
    tryBlock();
    return YES;
  } @catch (NSException *exception) {
    if (outError) {
      NSString *reason = exception.reason ?: @"Unknown native exception";
      *outError = [NSError errorWithDomain:@"VestroSubjectLift"
                                       code:-1
                                   userInfo:@{
        NSLocalizedDescriptionKey: [NSString stringWithFormat:@"%@: %@", exception.name ?: @"NSException", reason]
      }];
    }
    return NO;
  }
}
