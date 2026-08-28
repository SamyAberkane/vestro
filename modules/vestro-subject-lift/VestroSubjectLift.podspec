require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VestroSubjectLift'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.author         = 'Vestro'
  s.homepage       = 'https://vestro.app'
  s.platforms      = { ios: '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'CoreImage', 'UIKit'

  # Matches Expo's own modules exactly (see e.g. expo-image-manipulator's
  # podspec) — DEFINES_MODULE is what makes the Swift half of this pod able
  # to see VestroTryCatch, the plain Objective-C function declared in
  # VestroObjCTryCatch.h, without a separate bridging header. Without it,
  # mixed Swift/Objective-C sources in the same pod target aren't reliably
  # exposed to each other.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
