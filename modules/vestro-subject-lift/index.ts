import { requireNativeModule } from 'expo-modules-core';

type VestroSubjectLiftNativeModule = {
  liftSubject(uri: string): Promise<string>;
};

const nativeModule = requireNativeModule<VestroSubjectLiftNativeModule>('VestroSubjectLift');

/**
 * Runs real on-device instance segmentation (Vision's
 * VNGenerateForegroundInstanceMaskRequest, iOS 17+ only — the same API
 * behind Photos' "lift subject" long-press) on a local photo, and returns a
 * file:// URI to the isolated subject as a transparent PNG. Throws on older
 * iOS, when no subject is found, or on any other failure — callers must
 * catch and fall back (see utils/remove-background.ts).
 */
export function liftSubject(uri: string): Promise<string> {
  return nativeModule.liftSubject(uri);
}
