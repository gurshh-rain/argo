# Argo for Windows

The Windows version of Argo, built with Electron. It uses the same local orchestrator as the Mac app
(`../orchestrator`), so planning, routing by difficulty, worktrees, the shared record, review, Ollama
and usage tracking behave the same. This folder is the window and the terminals.

## Run from source (on Windows)

Requirements: Node 24+, git, and at least one of `claude`, `codex`, `devin` on your PATH.

```
cd windows
npm install
npm start
```

## Package

```
npm run package          # writes dist\Argo-win32-x64\Argo.exe, dist\Argo-win32-x64.zip and dist\latest-win.json
```

Package on Windows. The terminal library is native and `npm install` fetches it for the machine it runs
on; packaging from a Mac needs `npm install --no-save --force @lydell/node-pty-win32-x64@1.1.0` first
(and again after any other `npm install`, which removes it).

`latest-win.json` is the manifest the in-app updater reads. It is written only when the release key is
at `~/.argo-signing/ed25519.key` (or `ARGO_PRIVATE_KEY_FILE`), the same key the Mac build signs with.
Attach both the zip and `latest-win.json` to the GitHub release, tagged `v<version>`.

## What is here

Everything the Mac app has, in the same places:

- Workspaces in the sidebar (with or without a folder): rename, describe, delete, back and forward.
- Terminals with split right / split down, draggable dividers, and a saved default layout. Plain ones are
  PowerShell; Claude, Devin, Codex and Ollama terminals run that CLI and end when it does. A CLI you start
  yourself in a plain terminal is noticed, and subtasks are handed to the matching open terminal.
- Git worktree terminals: start an agent in a fresh worktree from the latest remote code, pull, remove.
- `argo-msg` (on the PATH of every Argo terminal) for terminals to message each other.
- The prompt bar with Follow-up / New task, file attachments (paperclip, or drop files on it) and plan
  approval; subtask chips; orchestrator and subtask panes.
- Files (with a name filter), Record, Report and Usage in the right panel.
- Settings (theme, updates, model controls) and Phone (pairing code and QR).
- Notifications when an agent needs you or a run finishes, and the Argo icon in the notification area:
  closing the window keeps the terminals running; quit from that icon or with Ctrl+Shift+Q.
- In-app updates: a newer release is downloaded, checked against the release key, and swapped in.

## Keys

The Mac app's menu-bar commands are under the ☰ button at the top of the sidebar. Their shortcuts carry
Shift or Alt, so the plain Ctrl keys stay with whatever runs in the terminal.

| | |
|---|---|
| New workspace / open folder | Ctrl+Shift+N / Ctrl+Shift+O |
| New terminal / new Claude, Devin, Codex, Ollama, Shell | Ctrl+Shift+T / Alt+Shift+1 … 5 |
| Split right / down | Ctrl+Shift+D / Alt+Shift+D |
| Close pane / close workspace | Ctrl+Shift+W / Alt+Shift+W |
| Next / previous pane | Alt+Shift+] / Alt+Shift+[ |
| Next / previous workspace, workspace 1 to 9 | Ctrl+Tab / Ctrl+Shift+Tab, Alt+1 … 9 |
| Jump to unread | Ctrl+Shift+U |
| Sidebar / files panel | Ctrl+Shift+B / Alt+Shift+B |
| Approve the plan | Ctrl+Enter |
| Copy / paste in a terminal | Ctrl+C with text selected, Ctrl+V (or Ctrl+Shift+C / Ctrl+Shift+V) |
| Settings | Ctrl+, |

## Checking the window without Windows

Electron runs the same code on a Mac (with zsh in place of PowerShell):

```
ARGO_HOME=/tmp/argo-home ARGO_PORT=4399 npx electron . --user-data-dir=/tmp/argo-ud --snapshot /tmp/out.png
```

`ARGO_TAB=Usage`, `ARGO_SHEET=settings|phone` and `ARGO_DEMO_TEAM=1` choose what the snapshot shows. Use a
separate `ARGO_HOME` and `ARGO_PORT` so it does not touch the orchestrator of an installed Argo.

## Not here yet

- An installer and code signing: the build is an unsigned folder with `Argo.exe`, so SmartScreen will warn.
