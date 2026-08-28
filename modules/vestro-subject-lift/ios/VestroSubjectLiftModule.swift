import CoreImage
import CoreImage.CIFilterBuiltins
import ExpoModulesCore
import UIKit
import Vision

enum VestroSubjectLiftError: Error, CustomStringConvertible {
  case unavailableOS
  case invalidImage
  case noSubjectDetected
  case renderFailed

  var description: String {
    switch self {
    case .unavailableOS: return "On-device subject lift requires iOS 17 or later."
    case .invalidImage: return "Could not read the source image."
    case .noSubjectDetected: return "No clear subject was detected in the photo."
    case .renderFailed: return "Could not render the isolated subject."
    }
  }
}

// Real, on-device background removal — no cloud call, ever. Two Apple Vision
// techniques are tried in order, each covering the other's weak spot:
//
// 1. VNGenerateForegroundInstanceMaskRequest (iOS 17+, the API behind Photos'
//    "lift subject" long-press) — a precise, hard-edged cutout, but it only
//    returns a result when it's confident it found a distinct "instance",
//    which flat, low-contrast product-style photos (a garment laid on a bed,
//    hung on a plain door) don't always give it.
// 2. If that finds nothing: VNGenerateObjectnessBasedSaliencyImageRequest
//    (iOS 14+, much older and more permissive — it almost always finds
//    *something* worth looking at) locates roughly where the item is, then a
//    border-color flood-fill — the same technique already proven earlier
//    this project on gradient studio backgrounds — clears the background
//    from that tightly-cropped region, where the crop's own edges are far
//    more reliably "background" than the full original photo's edges were.
//
// Every failure path throws a typed error rather than letting a Vision call
// fail silently or crash the app — ExpoModulesCore turns a Swift `throw`
// from an AsyncFunction into a normal rejected JS Promise, which is what lets
// the caller catch it and show a real error instead of losing the app.
public class VestroSubjectLiftModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VestroSubjectLift")

    AsyncFunction("liftSubject") { (uri: String) -> String in
      try Self.liftSubject(fromUri: uri)
    }
  }

  private static func liftSubject(fromUri uri: String) throws -> String {
    guard #available(iOS 17.0, *) else {
      throw VestroSubjectLiftError.unavailableOS
    }

    guard
      let url = URL(string: uri),
      let data = try? Data(contentsOf: url),
      let sourceImage = UIImage(data: data)
    else {
      throw VestroSubjectLiftError.invalidImage
    }

    // A photo taken with the phone held upright is very often stored with
    // its pixels in landscape order plus an EXIF orientation flag saying
    // "rotate this to display it correctly" — sourceImage.cgImage alone
    // ignores that flag entirely. Re-rendering through UIGraphicsImageRenderer
    // — which *does* respect UIImage's orientation when drawing — both
    // normalizes that rotation and downscales in the same pass (Vision is
    // expensive on very large images, and this app never displays clothing
    // photos above ~1024px anyway; see MAX_UPLOAD_WIDTH in
    // utils/remove-background.ts), so every downstream step sees a genuinely
    // upright buffer regardless of how the photo was held.
    guard let cgImage = normalizedAndResized(sourceImage, maxDimension: 1600) else {
      throw VestroSubjectLiftError.invalidImage
    }

    // Everything below is wrapped in the ObjC try/catch bridge, not just the
    // calls expected to fail — Vision and its neighboring frameworks have
    // been known to raise a raw NSException (not a Swift-catchable error) on
    // certain real-world inputs, and an uncaught one there would abort the
    // whole app with no way for Swift's do/catch to intervene. Any resulting
    // error here just means "this photo failed" on the JS side, never a
    // crash.
    var outputCGImage: CGImage?
    var pipelineError: NSError?
    let succeeded = VestroTryCatch({
      outputCGImage = instanceMaskCutout(cgImage) ?? saliencyChromaKeyCutout(cgImage)
    }, &pipelineError)

    guard succeeded else {
      throw VestroSubjectLiftError.renderFailed
    }
    guard let outputCGImage else {
      throw VestroSubjectLiftError.noSubjectDetected
    }

    guard
      let pngData = UIImage(cgImage: outputCGImage).pngData(),
      let outputURL = writeTempPng(pngData)
    else {
      throw VestroSubjectLiftError.renderFailed
    }

    return outputURL.absoluteString
  }

  // MARK: - Technique 1: instance segmentation
  //
  // Vision actually offers two ways to get from a foreground-instance
  // request to a final image: generateMaskedImage(ofInstances:from:...)
  // returns the finished cutout directly, or generateScaledMaskForImage(...)
  // returns just the mask, which the caller then composites by hand with
  // Core Image. This uses the second, more manual path on purpose — it's
  // the one publicly documented with a verified, working end-to-end example
  // (createwithswift.com's background-removal walkthrough), whereas the
  // more direct method hadn't been cross-checked against a real
  // known-working reference before this.
  // Only ever called from inside liftSubject's own `#available(iOS 17.0, *)`
  // runtime guard above, but Swift still requires this declaration itself
  // to carry the annotation — it doesn't infer availability across a
  // function boundary from the call site alone. Without this, the plain
  // unconditional VNGenerateForegroundInstanceMaskRequest() call below
  // fails to COMPILE (not just run) on any project whose deployment target
  // is below iOS 17, which every Expo/EAS build here is.
  @available(iOS 17.0, *)
  private static func instanceMaskCutout(_ cgImage: CGImage) -> CGImage? {
    let inputImage = CIImage(cgImage: cgImage)
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(ciImage: inputImage)

    guard (try? handler.perform([request])) != nil, let observation = request.results?.first else {
      return nil
    }

    guard
      let maskPixelBuffer = try? observation.generateScaledMaskForImage(
        forInstances: observation.allInstances,
        from: handler
      )
    else {
      return nil
    }

    let maskImage = CIImage(cvPixelBuffer: maskPixelBuffer)

    let filter = CIFilter.blendWithMask()
    filter.inputImage = inputImage
    filter.maskImage = maskImage
    filter.backgroundImage = CIImage.empty()

    guard let outputImage = filter.outputImage else { return nil }
    return CIContext().createCGImage(outputImage, from: inputImage.extent)
  }

  // MARK: - Technique 2: saliency crop + border-color flood-fill

  private static func saliencyChromaKeyCutout(_ cgImage: CGImage) -> CGImage? {
    let request = VNGenerateObjectnessBasedSaliencyImageRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])

    guard
      (try? handler.perform([request])) != nil,
      let observation = request.results?.first,
      let salientObject = observation.salientObjects?.first
    else {
      return nil
    }

    let imageWidth = CGFloat(cgImage.width)
    let imageHeight = CGFloat(cgImage.height)

    // Vision's normalized boundingBox is bottom-left-origin, y-up; CGImage
    // cropping needs top-left-origin, y-down pixel coordinates.
    let box = salientObject.boundingBox
    var cropRect = CGRect(
      x: box.origin.x * imageWidth,
      y: (1 - box.origin.y - box.height) * imageHeight,
      width: box.width * imageWidth,
      height: box.height * imageHeight
    )
    // A little breathing room around the detected object so the flood-fill
    // below still has a clean ring of genuine background to seed from.
    cropRect = cropRect.insetBy(dx: -cropRect.width * 0.12, dy: -cropRect.height * 0.12)
    cropRect = cropRect.intersection(CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight))

    guard cropRect.width >= 8, cropRect.height >= 8, let cropped = cgImage.cropping(to: cropRect) else {
      return nil
    }

    return floodFillTransparent(cropped)
  }

  // Same design already proven earlier this project on gradient studio
  // backgrounds: sample the median border color, then flood-fill outward
  // re-checking tolerance against each newly-cleared neighbor's own color
  // (not just the original sample) so it can walk a slowly drifting
  // gradient, capped by a looser drift limit from the original sample so it
  // can't eat through a garment of gradually-changing shading.
  private static func floodFillTransparent(_ cgImage: CGImage) -> CGImage? {
    let width = cgImage.width
    let height = cgImage.height
    guard width > 0, height > 0 else { return nil }

    let bytesPerPixel = 4
    let bytesPerRow = bytesPerPixel * width
    var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)

    guard
      let context = CGContext(
        data: &pixels,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else {
      return nil
    }
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    func offset(_ x: Int, _ y: Int) -> Int { (y * width + x) * bytesPerPixel }

    func median(_ values: [UInt8]) -> Int {
      let sorted = values.sorted()
      return Int(sorted[sorted.count / 2])
    }

    var reds: [UInt8] = []
    var greens: [UInt8] = []
    var blues: [UInt8] = []
    for x in 0..<width {
      for y in [0, height - 1] {
        let o = offset(x, y)
        reds.append(pixels[o]); greens.append(pixels[o + 1]); blues.append(pixels[o + 2])
      }
    }
    for y in 0..<height {
      for x in [0, width - 1] {
        let o = offset(x, y)
        reds.append(pixels[o]); greens.append(pixels[o + 1]); blues.append(pixels[o + 2])
      }
    }
    let bgR = median(reds), bgG = median(greens), bgB = median(blues)

    let localStepTolerance = 16
    let maxDriftFromSample = 46

    func within(_ o: Int, _ r: Int, _ g: Int, _ b: Int, _ tolerance: Int) -> Bool {
      abs(Int(pixels[o]) - r) <= tolerance
        && abs(Int(pixels[o + 1]) - g) <= tolerance
        && abs(Int(pixels[o + 2]) - b) <= tolerance
    }

    var visited = [Bool](repeating: false, count: width * height)
    var stack: [(x: Int, y: Int, r: Int, g: Int, b: Int)] = []

    func maybePush(_ x: Int, _ y: Int, _ refR: Int, _ refG: Int, _ refB: Int) {
      guard x >= 0, y >= 0, x < width, y < height else { return }
      let index = y * width + x
      if visited[index] { return }
      visited[index] = true
      let o = offset(x, y)
      if within(o, refR, refG, refB, localStepTolerance) && within(o, bgR, bgG, bgB, maxDriftFromSample) {
        stack.append((x, y, refR, refG, refB))
      }
    }

    for x in 0..<width {
      maybePush(x, 0, bgR, bgG, bgB)
      maybePush(x, height - 1, bgR, bgG, bgB)
    }
    for y in 0..<height {
      maybePush(0, y, bgR, bgG, bgB)
      maybePush(width - 1, y, bgR, bgG, bgB)
    }

    while let next = stack.popLast() {
      let o = offset(next.x, next.y)
      let r = Int(pixels[o]), g = Int(pixels[o + 1]), b = Int(pixels[o + 2])
      pixels[o + 3] = 0
      maybePush(next.x - 1, next.y, r, g, b)
      maybePush(next.x + 1, next.y, r, g, b)
      maybePush(next.x, next.y - 1, r, g, b)
      maybePush(next.x, next.y + 1, r, g, b)
    }

    return context.makeImage()
  }

  // MARK: - Shared helpers

  // image.size (unlike image.cgImage's raw pixel width/height) already
  // accounts for orientation, and .draw(in:) applies the orientation
  // transform when rendering — so this both normalizes rotation and
  // downscales in one pass, and the output CGImage is always genuinely
  // upright regardless of the source photo's EXIF orientation.
  private static func normalizedAndResized(_ image: UIImage, maxDimension: CGFloat) -> CGImage? {
    let width = image.size.width
    let height = image.size.height
    guard width > 0, height > 0 else { return nil }

    let largestSide = max(width, height)
    let scale = largestSide > maxDimension ? maxDimension / largestSide : 1
    let newSize = CGSize(width: width * scale, height: height * scale)

    let renderer = UIGraphicsImageRenderer(size: newSize)
    let normalizedImage = renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: newSize))
    }
    return normalizedImage.cgImage
  }

  private static func writeTempPng(_ data: Data) -> URL? {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("png")
    guard (try? data.write(to: url)) != nil else { return nil }
    return url
  }
}
