// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Argo",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", exact: "1.10.1")
    ],
    targets: [
        .executableTarget(name: "Argo", dependencies: [.product(name: "SwiftTerm", package: "SwiftTerm")], path: "Sources/Argo")
    ],
    swiftLanguageVersions: [.v5]
)
