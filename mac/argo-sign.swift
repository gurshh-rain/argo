// argo-sign: Ed25519 keygen / sign / verify for Argo's in-app updater.
//
// The app only installs an update whose disk image carries a signature made with the private key
// whose public half is compiled into Updater.swift. Keys are CryptoKit raw 32-byte values, base64.
//
//   swift argo-sign.swift keygen                        writes ~/.argo-signing/ed25519.key, prints the public key
//   swift argo-sign.swift sign <private-key-file> <file>          prints the base64 signature
//   swift argo-sign.swift verify <public-b64> <signature-b64> <file>   exits 0 if valid
import Foundation
import CryptoKit

func die(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: keygen | sign <private-key-file> <file> | verify <public> <signature> <file>") }

switch args[1] {
case "keygen":
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".argo-signing")
    let file = dir.appendingPathComponent("ed25519.key")
    // never overwrite: installed copies only trust the key they were built with
    if FileManager.default.fileExists(atPath: file.path) { die("A signing key already exists at \(file.path). Refusing to replace it.") }
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let key = Curve25519.Signing.PrivateKey()
    FileManager.default.createFile(atPath: file.path, contents: Data(key.rawRepresentation.base64EncodedString().utf8), attributes: [.posixPermissions: 0o600])
    print("PUBLIC " + key.publicKey.rawRepresentation.base64EncodedString())

case "sign":
    guard args.count == 4, let text = try? String(contentsOfFile: args[2], encoding: .utf8),
          let priv = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)),
          let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: priv) else { die("usage: sign <private-key-file> <file>") }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: args[3])) else { die("cannot read \(args[3])") }
    guard let sig = try? key.signature(for: data) else { die("signing failed") }
    print(sig.base64EncodedString())

case "verify":
    guard args.count == 5, let pub = Data(base64Encoded: args[2]), let sig = Data(base64Encoded: args[3]),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pub) else { die("usage: verify <public> <signature> <file>") }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: args[4])) else { die("cannot read \(args[4])") }
    if key.isValidSignature(sig, for: data) { print("OK") } else { die("INVALID signature") }

default:
    die("unknown command: \(args[1])")
}
