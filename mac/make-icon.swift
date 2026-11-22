// Turns a logo image into mac/AppIcon.icns: the centre square of the image on a macOS-style rounded tile.
// Usage: swift make-icon.swift ../web/public/argo.png
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let src = NSImage(contentsOfFile: args[1]),
      let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("usage: swift make-icon.swift <image>") }

// centre square of the source
let side = min(cg.width, cg.height)
let square = cg.cropping(to: CGRect(x: (cg.width - side) / 2, y: (cg.height - side) / 2, width: side, height: side))!

func render(_ px: Int) -> Data {
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    // Apple's icon grid: an 824pt tile inside a 1024pt canvas, corner radius about 22.5% of the tile
    let inset = CGFloat(px) * 100 / 1024, tile = CGFloat(px) - inset * 2
    let rect = CGRect(x: inset, y: inset, width: tile, height: tile)
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: tile * 0.225, cornerHeight: tile * 0.225, transform: nil))
    ctx.clip()
    ctx.draw(square, in: rect)
    return NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
}

let set = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("AppIcon.iconset")
try? FileManager.default.removeItem(at: set)
try! FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try! render(base).write(to: set.appendingPathComponent("icon_\(base)x\(base).png"))
    try! render(base * 2).write(to: set.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", set.path, "-o", "AppIcon.icns"]
try! p.run()
p.waitUntilExit()
try! render(512).write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("argo-icon-preview.png"))
print(p.terminationStatus == 0 ? "wrote AppIcon.icns" : "iconutil failed")
