# Phone skill demo progress

Current scope: a small skill lets the active coding agent run the existing phone demo and consume its transcript in the same task. The user replaced the larger native integration plan with this hackathon approach.

Source baseline: main ccbebfb, merged into feat/call-user-skill. The previous native implementation is preserved locally in a Git stash on feat/direct-twilio and is not part of this branch.

Existing phone backend: /Users/gz/Documents/codevisor-call-demo. It already supports a custom prompt file, transcript output, one call per invocation, and tunnel reuse. Node24 is installed and existing five Argo tests passed before this change.

Completed: skill and private question helper, conditional work prompt, background backend directory access and Codex network setting. Independent synthetic checks and all nine current tests passed. One deliberate real call returned a transcript with exit 0 and the user confirmed success. No credentials or live transcript content are committed.

Merge verification: all 11 tests passed on Node24, including main's terminal routing and run deletion cases plus phone permission cases. Skill metadata, TypeScript syntax and Git whitespace checks passed. An independent scope reviewer confirmed all changes relative to main are phone related. mac/, web/, server.ts, store.ts, types.ts and engine.test.ts match main exactly. Interactive terminals keep their existing CLI permissions; the added directory and network grants apply to background workers. The live call verified the helper and backend, not a new interactive terminal session.

## Native Mac voice input

Current baseline: main 2e7bd32, branch feat/mac-voice-input. The prior Mac application was built and opened locally using a separate Swift 6.1.3 toolchain. Its backend is running on local port 4316 because another project owns port 4317.

User requested a microphone in the native Argo input area and explicitly chose direct API key editing in ~/.argo/.env. The user saved the key and the daemon was restarted. No key UI or key saving endpoint was added. Native implementation and independent bundle verification passed. The full suite passed 15 cases, including MP4 multipart and missing key tests. A system generated audio fixture returned correct text via the real ElevenLabs endpoint with HTTP 200. Native snapshot export visually confirms the microphone beside the draft send button. New app instance is open and the old user's terminal window is preserved. Actual user microphone capture remains for the user's first click and speech test. No further phone calls were made.

Main publication: user authorized merging the recording feature to main. Feature commit 1f3507f was integrated with latest main 4e4619f without conflicts. Independent merged checks passed 15 tests, the native release build, microphone bundle metadata and codesign verification. Upstream website and daemon recovery changes were preserved.
