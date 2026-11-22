# Phone skill demo progress

Current scope: a small skill lets the active coding agent run the existing phone demo and consume its transcript in the same task. The user replaced the larger native integration plan with this hackathon approach.

Source baseline: ef2ed0e. Current branch: feat/call-user-skill. The previous native implementation is preserved locally in a Git stash on feat/direct-twilio and is not part of this branch.

Existing phone backend: /Users/gz/Documents/codevisor-call-demo. It already supports a custom prompt file, transcript output, one call per invocation, and tunnel reuse. Node24 is installed and existing five Argo tests passed before this change.

Completed: skill and private question helper, conditional work prompt, background backend directory access and Codex network setting. Independent synthetic checks and all nine current tests passed. One deliberate real call returned a transcript with exit 0 and the user confirmed success. No credentials or live transcript content are committed.

Next: merge current main ccbebfb while preserving its terminal routing and all nonphone files. Interactive terminals keep their existing CLI permissions; the added directory and network grants apply to background workers. Run the merged checks and a separate scope review before publication.
