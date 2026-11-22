import AVFoundation
import SwiftUI

@MainActor
final class VoiceInput: NSObject, ObservableObject, AVAudioRecorderDelegate {
    enum Phase { case idle, permission, recording, transcribing }
    @Published private(set) var phase = Phase.idle
    @Published private(set) var error: String?
    var busy: Bool { phase != .idle }

    private var recorder: AVAudioRecorder?
    private var directory: URL?
    private var task: Task<Void, Never>?
    private var generation = 0
    private var daemon: Daemon?
    private var receive: ((String) -> Void)?

    func toggle(daemon: Daemon, configured: Bool, receive: @escaping (String) -> Void) {
        if phase == .recording { transcribe(); return }
        guard phase == .idle else { return }
        error = nil
        guard configured else {
            error = "Add ELEVENLABS_API_KEY to ~/.argo/.env and restart Argo's background service."
            return
        }
        self.daemon = daemon
        self.receive = receive
        phase = .permission
        generation += 1
        let current = generation
        task = Task { [weak self] in
            let allowed = await AVCaptureDevice.requestAccess(for: .audio)
            guard let self, !Task.isCancelled, self.generation == current else { return }
            self.task = nil
            guard allowed else {
                self.fail("Allow Argo in System Settings → Privacy & Security → Microphone, then try again.")
                return
            }
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("argo-voice-\(UUID().uuidString)", isDirectory: true)
                self.directory = folder
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                let recorder = try AVAudioRecorder(url: folder.appendingPathComponent("speech.m4a"), settings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64_000,
                ])
                self.recorder = recorder
                recorder.delegate = self
                guard recorder.prepareToRecord() else { throw Self.recordingError() }
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: recorder.url.path)
                guard recorder.record(forDuration: 120) else { throw Self.recordingError() }
                self.phase = .recording
            } catch {
                self.fail("Could not start microphone recording. Check your microphone and try again.")
            }
        }
    }

    private func transcribe() {
        guard phase == .recording, let recorder, let daemon else { return }
        phase = .transcribing
        recorder.delegate = nil
        recorder.stop()
        self.recorder = nil
        do {
            let file = try AVAudioFile(forReading: recorder.url)
            guard Double(file.length) / file.processingFormat.sampleRate >= 0.1 else {
                fail("Recording was too short. Click the microphone and speak before stopping.")
                return
            }
            let audio = try Data(contentsOf: recorder.url)
            cleanRecording()
            let current = generation
            task = Task { [weak self] in
                do {
                    let result: Transcript = try await daemon.request("POST", "voice/stt", body: ["audio": audio.base64EncodedString(), "mime": "audio/mp4"], timeout: 90)
                    guard let self, !Task.isCancelled, self.generation == current else { return }
                    self.task = nil
                    self.phase = .idle
                    let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if text.isEmpty { self.error = "No speech was recognized. Your draft is unchanged." }
                    else { self.receive?(text) }
                    self.receive = nil
                    self.daemon = nil
                } catch {
                    guard let self, !Task.isCancelled, self.generation == current else { return }
                    self.fail("Transcription failed: \(error.localizedDescription)")
                }
            }
        } catch {
            fail("Could not read the recording. Your draft is unchanged; please try again.")
        }
    }

    func cancel() {
        generation += 1
        task?.cancel()
        task = nil
        recorder?.delegate = nil
        recorder?.stop()
        recorder = nil
        cleanRecording()
        receive = nil
        daemon = nil
        phase = .idle
        error = nil
    }

    private func fail(_ message: String) {
        cancel()
        error = message
    }

    private func cleanRecording() {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
    }

    private static func recordingError() -> NSError { NSError(domain: "ArgoVoiceInput", code: 1) }
    private struct Transcript: Decodable { let text: String }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let id = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in
            guard let self, self.recorder.map(ObjectIdentifier.init) == id, self.phase == .recording else { return }
            if flag { self.transcribe() }
            else { self.fail("Recording stopped unexpectedly. Your draft is unchanged.") }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        let id = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in
            guard let self, self.recorder.map(ObjectIdentifier.init) == id else { return }
            self.fail("The microphone could not encode the recording. Your draft is unchanged.")
        }
    }
}
