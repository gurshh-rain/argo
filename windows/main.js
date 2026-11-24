// Argo for Windows (Electron). The same local orchestrator the Mac app uses does the planning, routing,
// worktrees and review; this process starts it, hosts the terminals, and serves the window.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pty = require('@lydell/node-pty')

const WIN = process.platform === 'win32'
const HOME = process.env.ARGO_HOME || path.join(os.homedir(), '.argo')
const MAIL = path.join(HOME, 'mail')
const BIN = path.join(HOME, 'bin')
const orchestratorDir = app.isPackaged ? path.join(process.resourcesPath, 'orchestrator') : path.join(__dirname, '..', 'orchestrator')
let win
let daemon

const config = () => JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'))
async function healthy() {
  try {
    const { port } = config()
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok
  } catch { return false }
}

// Electron's own Node runs the orchestrator, so nothing else has to be installed for it.
async function ensureOrchestrator() {
  if (await healthy()) return null
  if (!fs.existsSync(path.join(orchestratorDir, 'src', 'main.ts'))) return 'Orchestrator files not found next to the app.'
  fs.mkdirSync(HOME, { recursive: true })
  const log = fs.openSync(path.join(HOME, 'orchestrator.log'), 'a')
  daemon = spawn(process.execPath, ['src/main.ts'], { cwd: orchestratorDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', log, log], windowsHide: true })
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await healthy()) return null
    if (daemon.exitCode !== null) break
  }
  return 'The orchestrator did not start. See ' + path.join(HOME, 'orchestrator.log')
}

ipcMain.handle('api', async (_e, method, route, body) => {
  const { token, port } = config()
  const res = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
})
ipcMain.handle('ensure', ensureOrchestrator)
ipcMain.handle('info', () => ({ home: os.homedir(), platform: process.platform, version: app.getVersion(), msg: msgTool() }))
ipcMain.handle('chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], buttonLabel: 'Open as workspace' })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('listDir', (_e, dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.name !== '.DS_Store')
      .map((d) => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })))
  } catch { return [] }
})
ipcMain.handle('open', (_e, p) => shell.openPath(p))
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p))

// ---- terminals
const terms = new Map() // id -> { proc, name, kind, workspace }
const CLI = { claude: 'claude', devin: 'devin', codex: 'codex', ollama: 'ollama launch claude' }

function msgTool() { return path.join(BIN, WIN ? 'argo-msg.cmd' : 'argo-msg') }
// argo-msg: lets one terminal send a message to another. A small script run by Electron's Node,
// behind a shim so it works from cmd, PowerShell and sh alike.
function installMsgTool() {
  fs.mkdirSync(MAIL, { recursive: true })
  fs.mkdirSync(BIN, { recursive: true })
  const script = path.join(BIN, 'argo-msg.js')
  fs.writeFileSync(script, `const fs=require('fs'),path=require('path');const e=process.env;
if(!e.ARGO_MAIL||!e.ARGO_MEMBER){console.error('argo-msg only works inside a terminal opened by Argo.');process.exit(1)}
let names=[];try{names=fs.readFileSync(e.ARGO_ROSTER,'utf8').split(/\\r?\\n/).filter(n=>n&&n!==e.ARGO_MEMBER)}catch{}
const usage=()=>console.log('You are '+e.ARGO_MEMBER+'. Other terminals in this workspace:\\n'+names.map(n=>'  '+n).join('\\n')+'\\nusage: argo-msg "<name>" "<message>"    argo-msg --all "<message>"    argo-msg --list');
const a=process.argv.slice(2);if(!a.length||['-h','--help','-l','--list'].includes(a[0])){usage();process.exit(0)}
const to=a[0],text=a.slice(1).join(' ');if(!text){usage();process.exit(1)}
if(to!=='--all'&&!names.some(n=>n.toLowerCase()===to.toLowerCase())){console.error('No other terminal named "'+to+'" in this workspace. Names:\\n'+names.map(n=>'  '+n).join('\\n'));process.exit(1)}
const f=path.join(e.ARGO_MAIL,Date.now()+'-'+process.pid);
fs.writeFileSync(f+'.tmp',JSON.stringify({workspace:e.ARGO_WORKSPACE,from:e.ARGO_MEMBER,to,text}));fs.renameSync(f+'.tmp',f+'.msg');
console.log(to==='--all'?'Sent to everyone else.':'Sent to '+to+'.');`)
  if (WIN) fs.writeFileSync(msgTool(), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" %*\r\n`)
  else fs.writeFileSync(msgTool(), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
}
const rosterFile = (ws) => path.join(MAIL, 'roster-' + (ws.replace(/[^A-Za-z0-9]/g, '_').slice(-80) || 'none') + '.txt')
function writeRoster(ws) {
  fs.writeFileSync(rosterFile(ws), [...terms.values()].filter((t) => t.workspace === ws).map((t) => t.name).join('\n') + '\n')
}

ipcMain.handle('pty:create', (_e, { id, name, kind, cwd, workspace, cols, rows }) => {
  const file = WIN ? 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const args = WIN ? ['-NoLogo'] : ['-l']
  const env = { ...process.env, ARGO_MEMBER: name, ARGO_WORKSPACE: workspace, ARGO_MAIL: MAIL, ARGO_ROSTER: rosterFile(workspace), ARGO_MSG: msgTool(), TERM: 'xterm-256color' }
  delete env.ELECTRON_RUN_AS_NODE
  const proc = pty.spawn(file, args, { name: 'xterm-256color', cols: cols || 100, rows: rows || 30, cwd: fs.existsSync(cwd) ? cwd : os.homedir(), env })
  terms.set(id, { proc, name, kind, workspace })
  writeRoster(workspace)
  proc.onData((data) => win && !win.isDestroyed() && win.webContents.send('pty:data', id, data))
  proc.onExit(() => { win && !win.isDestroyed() && win.webContents.send('pty:exit', id) })
  // an agent terminal is a shell with the CLI started in it, so it stays usable if the CLI exits
  if (CLI[kind]) setTimeout(() => proc.write(CLI[kind] + '\r'), 600)
})
ipcMain.on('pty:write', (_e, id, data) => terms.get(id)?.proc.write(data))
ipcMain.on('pty:resize', (_e, id, cols, rows) => { try { terms.get(id)?.proc.resize(Math.max(2, cols), Math.max(2, rows)) } catch {} })
ipcMain.on('pty:kill', (_e, id) => {
  const t = terms.get(id)
  if (!t) return
  try { t.proc.kill() } catch {}
  terms.delete(id)
  writeRoster(t.workspace)
})

// Deliver messages written by argo-msg. Typed into the prompt where an agent runs; only shown in a plain shell.
function deliverMail() {
  let files = []
  try { files = fs.readdirSync(MAIL).filter((f) => f.endsWith('.msg')).sort() } catch { return }
  for (const f of files) {
    const p = path.join(MAIL, f)
    let m
    try { m = JSON.parse(fs.readFileSync(p, 'utf8')) } catch {}
    try { fs.unlinkSync(p) } catch {}
    if (!m || !m.text) continue
    const text = String(m.text).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
    for (const [id, t] of terms) {
      if (t.workspace !== m.workspace || t.name === m.from) continue
      if (m.to !== '--all' && t.name.toLowerCase() !== String(m.to).toLowerCase()) continue
      if (CLI[t.kind]) { t.proc.write(`[Message from ${m.from}] ${text}`); setTimeout(() => t.proc.write('\r'), 400) }
      else win?.webContents.send('pty:data', id, `\r\n\x1b[1;34m[Message from ${m.from}]\x1b[0m ${text}\r\n`)
      win?.webContents.send('mail', id, m.from, text)
    }
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  installMsgTool()
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640, backgroundColor: '#1e1e1e', title: 'Argo',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  setInterval(deliverMail, 1500)
  // `--snapshot out.png` renders the window to a file and quits (headless UI check)
  const i = process.argv.indexOf('--snapshot')
  if (i > 0 && process.argv[i + 1]) setTimeout(async () => {
    fs.writeFileSync(process.argv[i + 1], (await win.webContents.capturePage()).toPNG())
    app.quit()
  }, Number(process.env.ARGO_SNAPSHOT_DELAY || 6) * 1000)
})
app.on('window-all-closed', () => {
  for (const t of terms.values()) try { t.proc.kill() } catch {}
  app.quit() // the orchestrator keeps running so work in progress is not lost
})
