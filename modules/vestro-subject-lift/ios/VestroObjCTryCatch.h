#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Swift's do/catch can only catch Swift errors and NSError-bridged failures
// — it cannot catch a raw Objective-C NSException, which some system
// frameworks (Vision included, on certain inputs) still raise instead of
// throwing a proper error. An uncaught NSException aborts the whole process
// with no way for Swift to intervene. This tiny ObjC shim is the standard
// way around that: only Objective-C's @try/@catch can actually stop an
// NSException, so it catches it here and hands Swift a normal NSError
// instead of letting the exception keep propagating up to a crash.
BOOL VestroTryCatch(void (NS_NOESCAPE ^tryBlock)(void), NSError * _Nullable * _Nullable outError);

NS_ASSUME_NONNULL_END
