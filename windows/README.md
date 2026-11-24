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
npm run package          # writes dist\Argo-win32-x64\Argo.exe and dist\Argo-win32-x64.zip
```

Package on Windows. The terminal library is native and `npm install` fetches it for the machine it runs
on; packaging from a Mac needs `npm install --no-save --force @lydell/node-pty-win32-x64@1.1.0` first.

## What is here

- Workspaces in the sidebar (with or without a folder), rename, describe, delete.
- Terminals (PowerShell) with split right / split down, draggable dividers, and a saved default layout.
- Claude, Devin, Codex and Ollama terminals; subtasks are handed to the matching open terminal.
- `argo-msg` for terminals to message each other.
- The prompt bar with Follow-up / New task and plan approval; subtask chips; orchestrator and subtask panes.
- Files, Record and Report in the right panel; Settings with theme and model controls.

## Not here yet

- In-app updates, the Usage tab, git worktree terminals, the menu-bar icon and file attachments.
- An installer and code signing: the build is an unsigned folder with `Argo.exe`, so SmartScreen will warn.
