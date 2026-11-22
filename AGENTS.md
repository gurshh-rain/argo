# Argo

- `orchestrator/`: Node 24+ TypeScript run directly (type stripping, no build, no dependencies). Use `import type` for types and `.ts` import paths; no enums or parameter properties. Test: `cd orchestrator && npm test`.
- `mac/`: SwiftUI via SwiftPM. Build with `mac/build.sh` (uses the macOS 26 SDK when full Xcode is absent, because the 27 SDK's `@State` macro needs Xcode's plugin). Headless UI check: `mac/build/Argo.app/Contents/MacOS/Argo --snapshot /tmp/out.png`.
- `web/`: Wasp 0.26 (TypeScript spec in `main.wasp.ts`). Verify with `cd web && wasp compile`; do not run `tsc` directly. Run with `./dev.sh` (ports 4318/4319; `REACT_APP_API_URL` is managed by Wasp, set URLs via `wasp start --server-url`).
- Secrets live in `~/.argo/.env` and `web/.env.server`, never in the repo.
