// Argo for Windows (Electron). The same local orchestrator the Mac app uses does the planning, routing,
// worktrees and review; this process starts it, hosts the terminals, and serves the window.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, Notification, clipboard, nativeImage } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUpdater } = require('./update')

const WIN = process.platform === 'win32'
const HOME = process.env.ARGO_HOME || path.join(os.homedir(), '.argo')
const MAIL = path.join(HOME, 'mail')
const BIN = path.join(HOME, 'bin')
const orchestratorDir = app.isPackaged ? path.join(process.resourcesPath, 'orchestrator') : path.join(__dirname, '..', 'orchestrator')
const asset = (f) => path.join(__dirname, 'assets', f)
let win, tray, daemon, quitting = false, toldAboutTray = false

// The terminal library is native. Without it the app still opens and says why terminals cannot.
let pty = null, ptyError = ''
try { pty = require('@lydell/node-pty') } catch (e) { ptyError = `The terminal library could not be loaded (${String(e.message || e).split('\n')[0]}). Reinstall Argo, or run npm install in the windows folder.` }

const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- orchestrator
const config = () => JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'))
// The running orchestrator's build id ("" from builds that predate it), or null when none is reachable.
async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${config().port}/health`, { signal: AbortSignal.timeout(1000) })
    if (!res.ok) return null
    const text = await res.text()
    return text.startsWith('ok ') ? text.slice(3).trim() : ''
  } catch { return null }
}
// Hash of the bundled orchestrator code, computed exactly as the orchestrator computes its own.
function bundledBuild() {
  try {
    const src = path.join(orchestratorDir, 'src'), h = crypto.createHash('sha256')
    for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.ts')).sort()) h.update(fs.readFileSync(path.join(src, f)))
    return h.digest('hex').slice(0, 12)
  } catch { return null }
}
async function request(method, route, body) {
  const { token, port } = config()
  const res = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Electron's own Node runs the orchestrator, so nothing else has to be installed for it.
// Returns null when the orchestrator is reachable, otherwise a message for the user.
async function startOrchestrator() {
  const running = await health()
  if (running !== null) {
    const mine = bundledBuild()
    if (!mine || running === mine) return null
    // left running from an older build, which would answer "Not found" to newer features: replace it
    await request('POST', 'quit').catch(() => {})
    for (let i = 0; i < 20 && (await health()) !== null; i++) await sleep(250)
    if ((await health()) !== null) return null
  }
  if (!fs.existsSync(path.join(orchestratorDir, 'src', 'main.ts'))) return 'Orchestrator files not found next to the app.'
  fs.mkdirSync(HOME, { recursive: true })
  const logFile = path.join(HOME, 'orchestrator.log')
  const log = fs.openSync(logFile, 'a')
  try {
    daemon = spawn(process.execPath, ['src/main.ts'], { cwd: orchestratorDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', log, log], windowsHide: true })
    daemon.on('error', () => {})
  } catch (e) { return `Could not start the orchestrator: ${e.message}` } finally { fs.closeSync(log) }
  const mine = daemon
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    if ((await health()) !== null) return null
    if (mine.exitCode !== null) break
  }
  let tail = ''
  try { tail = fs.readFileSync(logFile, 'utf8').slice(-300) } catch {}
  return `The orchestrator did not start. See ${logFile}\n${tail}`
}
// one start at a time, however many callers are waiting on it
let ensuring = null
const ensureOrchestrator = () => (ensuring ||= startOrchestrator().finally(() => (ensuring = null)))

ipcMain.handle('api', (_e, method, route, body) => request(method, route, body))
ipcMain.handle('ensure', ensureOrchestrator)
ipcMain.handle('info', () => ({
  home: os.homedir(), platform: process.platform, version: app.getVersion(), msg: msgTool(), packaged: app.isPackaged,
  demo: { tab: process.env.ARGO_TAB || '', sheet: process.env.ARGO_SHEET || '', team: !!process.env.ARGO_DEMO_TEAM },
}))
ipcMain.handle('chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], buttonLabel: 'Open as workspace' })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('listDir', (_e, dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.name !== '.DS_Store')
      .map((d) => {
        let isDir = d.isDirectory()
        if (d.isSymbolicLink()) try { isDir = fs.statSync(path.join(dir, d.name)).isDirectory() } catch {}
        return { name: d.name, path: path.join(dir, d.name), dir: isDir }
      })
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })))
  } catch { return [] }
})
ipcMain.handle('open', (_e, p) => shell.openPath(String(p)))
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(String(p)))
ipcMain.handle('openExternal', (_e, url) => (/^https?:\/\//i.test(String(url)) ? shell.openExternal(String(url)) : undefined))
ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text || '')))
ipcMain.handle('paste', () => clipboard.readText())
ipcMain.handle('qr', (_e, text) => require('qrcode').toDataURL(String(text), { margin: 1, scale: 6 }).catch(() => ''))
ipcMain.on('quit', () => app.quit())

// Files attached in the composer are copied into ~/.argo/attachments/<batch>/ (which every agent may read, and
// which survives the originals being moved). Returns the lines that tell the agents where they are.
ipcMain.handle('pickFiles', async () => {
  // Windows cannot offer files and folders in one dialog; folders can be dropped on the composer instead
  const r = await dialog.showOpenDialog(win, { properties: WIN ? ['openFile', 'multiSelections'] : ['openFile', 'openDirectory', 'multiSelections'], buttonLabel: 'Attach' })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('attach', (_e, files) => {
  if (!Array.isArray(files) || !files.length) return ''
  const batch = path.join(HOME, 'attachments', `${new Date().toISOString().replace(/[:.]/g, '')}-${crypto.randomBytes(3).toString('hex')}`)
  fs.mkdirSync(batch, { recursive: true })
  const lines = files.map((f) => {
    const dest = path.join(batch, path.basename(String(f)))
    try { fs.cpSync(String(f), dest, { recursive: true }); return `- ${dest}` } catch (e) { return `- ${f} (could not be copied: ${e.message})` }
  })
  return '\n\nAttached files (read them as part of this task):\n' + lines.join('\n')
})

// ---- terminals
const terms = new Map() // id -> { proc, name, kind, workspace, cwd, worktree, exited, cli }
const CLI = { claude: 'claude', devin: 'devin', codex: 'codex', ollama: 'ollama' }
const folderOf = (ws) => (!ws || ws.startsWith('ws:') ? '' : ws)
const live = (ws) => [...terms.values()].filter((t) => t.workspace === ws && !t.exited)

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
  const sh = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`
  // setlocal keeps ELECTRON_RUN_AS_NODE out of the shell that called it
  if (WIN) fs.writeFileSync(msgTool(), `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" %*\r\n`)
  // the same command without an extension, for Git Bash on Windows and for sh everywhere else
  fs.writeFileSync(path.join(BIN, 'argo-msg'), sh, { mode: 0o755 })
}
// One roster file per workspace: the names a terminal there may write to.
const rosterFile = (ws) => path.join(MAIL, 'roster-' + (ws.replace(/[^\p{L}\p{N}]/gu, '_').slice(-80) || 'none') + '.txt')
function writeRoster(ws) {
  try { fs.writeFileSync(rosterFile(ws), live(ws).map((t) => t.name).join('\n') + '\n') } catch {}
  // only real project folders get a team file; a workspace without a folder runs in the home folder
  const folder = folderOf(ws)
  if (!folder) return
  try {
    fs.mkdirSync(path.join(folder, '.argo'), { recursive: true })
    const rows = live(ws).map((t) => `- ${t.name} (${t.kind})${t.worktree ? `, worktree ${t.worktree} at ${t.cwd}` : ', main checkout'}`)
    fs.writeFileSync(path.join(folder, '.argo', 'team.md'), `# Argo team\n\nTerminals currently open in this project. Each is a separate agent working in parallel.\n\n${rows.join('\n')}\n`)
  } catch {}
}

// What an agent is told when its terminal starts. Kept free of double quotes and angle brackets, which
// do not survive the trip through cmd and a .cmd shim.
function intro(t) {
  const folder = folderOf(t.workspace), argo = folder && path.join(folder, '.argo')
  const place = t.worktree ? ` You work in your own git worktree (branch argo/wt/${t.worktree}), so other agents cannot see or overwrite your edits until they are merged. It tracks the remote branch: run git pull before you start and before you finish, so you build on what teammates have pushed.` : ''
  const team = argo ? ` Read ${path.join(argo, 'team.md')} for the roster and ${path.join(argo, 'MEMORY.md')} for the shared record. Coordinate through those files; write decisions as notes in the folder ${path.join(argo, 'notes')} and stay within your own task: do not overwrite files another member is editing.` : ''
  const tool = WIN ? 'argo-msg' : msgTool()
  return `You are ${t.name}, one member of a team of coding agents working ${folder ? 'in this repo' : 'here'} at the same time.${place}${team} To tell another member something directly, run ${tool} with two quoted arguments: their name, then the message (${tool} --list shows the names). Messages from other members arrive in your prompt as [Message from NAME]; act on them or reply the same way.`
}
// An agent terminal runs the CLI itself, so it ends when the CLI does and nothing is ever typed into a bare shell.
function launch(t) {
  // Ollama has no agent of its own: its launcher starts Claude Code on a model you pick from its menu
  const argv = t.kind === 'ollama' ? ['ollama', 'launch', 'claude'] : CLI[t.kind] ? [CLI[t.kind], ...(t.kind === 'devin' ? ['--'] : []), intro(t)] : null
  // on Windows the CLIs are .cmd shims, which cmd starts whatever PowerShell's script policy says
  if (WIN) return argv ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', ...argv] } : { file: 'powershell.exe', args: ['-NoLogo'] }
  // a login + interactive shell so PATH matches the user's own terminal
  const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'"
  return { file: process.env.SHELL || '/bin/zsh', args: argv ? ['-l', '-i', '-c', 'exec ' + [argv[0], ...argv.slice(1).map(q)].join(' ')] : ['-l'] }
}

ipcMain.handle('pty:create', (_e, { id, name, kind, cwd, workspace, worktree, cols, rows }) => {
  if (!pty) return { error: ptyError }
  const t = { proc: null, name, kind, workspace, worktree: worktree || null, cwd: fs.existsSync(cwd) ? cwd : os.homedir(), exited: false, cli: CLI[kind] ? kind : null }
  const folder = folderOf(workspace)
  const env = { ...process.env, ARGO_MEMBER: name, ARGO_WORKSPACE: workspace, ARGO_MAIL: MAIL, ARGO_ROSTER: rosterFile(workspace), ARGO_MSG: msgTool(), TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  if (folder) Object.assign(env, { ARGO_TEAM_FILE: path.join(folder, '.argo', 'team.md'), ARGO_RECORD: path.join(folder, '.argo', 'MEMORY.md') })
  if (worktree) env.ARGO_WORKTREE = worktree
  delete env.ELECTRON_RUN_AS_NODE
  // argo-msg is on the PATH of every Argo terminal
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
  env[pathKey] = BIN + path.delimiter + (env[pathKey] || '')
  terms.set(id, t)
  writeRoster(workspace)
  const { file, args } = launch(t)
  try {
    t.proc = pty.spawn(file, args, { name: 'xterm-256color', cols: Math.max(2, cols || 100), rows: Math.max(2, rows || 30), cwd: t.cwd, env })
  } catch (e) {
    terms.delete(id)
    writeRoster(workspace)
    return { error: `Could not start ${file}: ${e.message}` }
  }
  t.proc.onData((data) => send('pty:data', id, data))
  t.proc.onExit(() => {
    t.exited = true
    t.cli = null
    if (terms.get(id) === t) { writeRoster(workspace); send('pty:exit', id) }
  })
  return { ok: true }
})
const write = (t, data) => { if (t && t.proc && !t.exited) try { t.proc.write(data) } catch {} }
ipcMain.on('pty:write', (_e, id, data) => write(terms.get(id), data))
ipcMain.on('pty:resize', (_e, id, cols, rows) => { const t = terms.get(id); if (t && t.proc && !t.exited) try { t.proc.resize(Math.max(2, cols), Math.max(2, rows)) } catch {} })
ipcMain.on('pty:kill', (_e, id) => {
  const t = terms.get(id)
  if (!t) return
  terms.delete(id)
  if (!t.exited) try { t.proc.kill() } catch {}
  t.exited = true
  writeRoster(t.workspace)
})

// ---- which coding CLI runs in each plain shell (the user may have typed `claude` into one)
const AGENT_BINS = ['claude', 'devin', 'codex']
function cliOf(row) {
  const name = row.name.toLowerCase().replace(/\.exe$/, '')
  if (AGENT_BINS.includes(name)) return name
  if (!['node', 'bun', 'deno'].includes(name)) return undefined
  const cmd = row.cmd.toLowerCase()
  return AGENT_BINS.find((b) => new RegExp(`[\\\\/@]${b}([\\\\/.-]|\\s|$)`).test(cmd))
}
// On Windows one hidden PowerShell stays open and is asked for the process table, which is far cheaper than starting one each time.
let ps = null, psBuf = '', psDone = null, psBroken = false
function winTable() {
  return new Promise((resolve) => {
    if (psBroken || psDone) return resolve(null)
    if (!ps) {
      try {
        ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
      } catch { psBroken = true; return resolve(null) }
      ps.stdout.setEncoding('utf8')
      ps.stdout.on('data', (d) => {
        psBuf += d
        const i = psBuf.indexOf('<<ARGO-END>>')
        if (i < 0) return
        const out = psBuf.slice(0, i)
        psBuf = ''
        if (psDone) psDone(out)
      })
      ps.on('error', () => { psBroken = true; ps = null; if (psDone) psDone(null) })
      ps.on('exit', () => { ps = null; if (psDone) psDone(null) })
      ps.stdin.on('error', () => {})
    }
    const timer = setTimeout(() => psDone && psDone(null), 5000)
    psDone = (out) => {
      clearTimeout(timer)
      psDone = null
      if (out === null) { psBuf = ''; return resolve(null) }
      resolve(out.split(/\r?\n/).map((l) => l.split('|')).filter((f) => f.length >= 3 && /^\d+$/.test(f[0])).map((f) => ({ pid: +f[0], ppid: +f[1], name: f[2], cmd: f.slice(3).join('|') })))
    }
    ps.stdin.write("Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.CommandLine }; '<<ARGO-END>>'\n")
  })
}
const unixTable = () => new Promise((resolve) => execFile('ps', ['-axo', 'pid=,ppid=,args='], { maxBuffer: 16 << 20 }, (err, out) => {
  if (err) return resolve(null)
  resolve(out.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], name: path.basename(m[3].split(' ')[0].replace(/^-/, '')), cmd: m[3] })))
}))
let scanning = false
async function detectCLIs() {
  const shells = [...terms.entries()].filter(([, t]) => t.kind === 'shell' && !t.exited && t.proc)
  if (!shells.length || scanning) return
  scanning = true
  try {
    const table = await (WIN ? winTable() : unixTable())
    if (!table) return
    const kids = new Map()
    for (const row of table) kids.set(row.ppid, [...(kids.get(row.ppid) || []), row])
    let changed = false
    for (const [, t] of shells) {
      let found = null
      const seen = new Set(), frontier = [t.proc.pid]
      while (frontier.length && !found) {
        const p = frontier.pop()
        if (seen.has(p)) continue
        seen.add(p)
        for (const row of kids.get(p) || []) {
          if ((found = cliOf(row) || null)) break
          frontier.push(row.pid)
        }
      }
      if (!t.exited && t.cli !== found) { t.cli = found; changed = true }
    }
    if (changed) sendCLIs()
  } finally { scanning = false }
}
const sendCLIs = () => send('cli', Object.fromEntries([...terms].map(([id, t]) => [id, t.cli])))

// ---- messages between terminals
// Deliver messages written by argo-msg. Typed into the prompt where an agent runs; only shown in a plain
// shell, which would run typed text as a command.
function deliverMail() {
  let files = []
  try { files = fs.readdirSync(MAIL).filter((f) => f.endsWith('.msg')).sort() } catch { return }
  for (const f of files) {
    const p = path.join(MAIL, f)
    let m
    try { m = JSON.parse(fs.readFileSync(p, 'utf8')) } catch {}
    try { fs.unlinkSync(p) } catch {}
    if (!m || !m.text || typeof m.workspace !== 'string') continue
    // one line of plain text: nothing in a message may act as a keystroke in the other terminal
    const text = String(m.text).replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
    const from = String(m.from || '')
    if (!text || !live(m.workspace).some((t) => t.name === from)) continue
    for (const [id, t] of terms) {
      if (t.workspace !== m.workspace || t.exited || t.name === from) continue
      if (m.to !== '--all' && t.name.toLowerCase() !== String(m.to).toLowerCase()) continue
      if (t.cli) { write(t, `[Message from ${from}] ${text}`); setTimeout(() => write(t, '\r'), 400) }
      else send('pty:data', id, `\r\n\x1b[1;34m[Message from ${from}]\x1b[0m ${text}\r\n`)
      send('mail', id, from, text)
      record(m.workspace, from, t.name, text)
    }
  }
}
// Keeps the conversation next to the shared record, so it can be read back later.
function record(ws, from, to, text) {
  const folder = folderOf(ws)
  if (!folder) return
  try {
    const file = path.join(folder, '.argo', 'messages.md')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file)) fs.writeFileSync(file, '# Messages between terminals\n\n')
    fs.appendFileSync(file, `- ${new Date().toLocaleTimeString()} **${from} → ${to}**: ${text}\n`)
  } catch {}
}

// ---- window, tray, notifications
function show() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
const command = (name, arg) => { show(); send('command', name, arg) }
ipcMain.on('notify', (_e, title, body) => {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: String(title), body: String(body), icon: asset('icon.png') })
  n.on('click', () => command('attention'))
  n.show()
})
// The Argo icon in the notification area: what needs you, jump to any workspace or terminal, add a member.
// Terminals keep running when the window is closed.
function trayMenu(s) {
  const needs = s.needs || 0
  return Menu.buildFromTemplate([
    { label: 'Show Argo', click: show },
    ...(needs ? [{ label: `${needs} need${needs === 1 ? 's' : ''} you: jump to it`, click: () => command('jumpUnread') }] : []),
    { type: 'separator' },
    ...(s.workspaces || []).map((w) => ({ label: w.name, submenu: [
      { label: 'Open workspace', click: () => command('selectWorkspace', w.key) },
      ...(w.terms.length ? [{ type: 'separator' }] : []),
      ...w.terms.map((t) => ({ label: t.name + (t.ring ? '  (unread)' : '') + (t.exited ? '  (exited)' : ''), click: () => command('focusTerm', t.id) })),
    ] })),
    { label: 'New Workspace', click: () => command('newWorkspace') },
    { type: 'separator' },
    { label: 'Add Member', submenu: (s.kinds || []).map((k) => ({ label: k.label, enabled: k.enabled, click: () => command('newMember', k.id) })) },
    { type: 'separator' },
    { label: 'Quit Argo', click: () => app.quit() },
  ])
}
ipcMain.on('tray', (_e, summary) => {
  if (!tray || tray.isDestroyed()) return
  tray.setContextMenu(trayMenu(summary || {}))
  const n = (summary && summary.needs) || 0
  tray.setToolTip(n ? `Argo: ${n} need${n === 1 ? 's' : ''} you` : 'Argo')
})

const updater = createUpdater({
  app, emit: (state) => send('update', state),
  // the orchestrator and the terminals run out of the app folder, which is about to be replaced
  beforeQuit: async () => {
    quitting = true
    for (const t of terms.values()) if (!t.exited) try { t.proc.kill() } catch {}
    if (ps) try { ps.kill() } catch {}
    await request('POST', 'quit').catch(() => {})
    for (let i = 0; i < 20 && (await health()) !== null; i++) await sleep(250)
  },
})
ipcMain.handle('update:state', () => updater.state())
ipcMain.on('update:check', () => updater.check())
ipcMain.on('update:install', () => updater.install())

// A second copy would fight this one over the terminals' mail, so it hands over and leaves.
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', show)
  app.whenReady().then(() => {
    if (WIN) app.setAppUserModelId('dev.argo.app')
    Menu.setApplicationMenu(null)
    installMsgTool()
    win = new BrowserWindow({
      width: 1440, height: 900, minWidth: 1000, minHeight: 640, backgroundColor: '#1e1e1e', title: 'Argo', icon: asset(WIN ? 'icon.ico' : 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    // the window only ever shows the app; links open in the browser
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' } })
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
    win.on('close', (e) => {
      if (quitting || !tray || tray.isDestroyed()) return
      e.preventDefault()
      win.hide()
      if (WIN && !toldAboutTray) {
        toldAboutTray = true
        try { tray.displayBalloon({ title: 'Argo is still running', content: 'Your terminals keep working. Click the Argo icon here to come back, or right-click it to quit.', iconType: 'info' }) } catch {}
      }
    })
    try {
      tray = new Tray(nativeImage.createFromPath(asset('tray.png')))
      tray.setToolTip('Argo')
      tray.setContextMenu(trayMenu({}))
      tray.on('click', show)
    } catch { tray = null }
    setInterval(deliverMail, 1500)
    setInterval(() => detectCLIs().catch(() => {}), 3000)
    // look for a newer release at launch, then every six hours while open
    if (app.isPackaged || process.env.ARGO_UPDATE_MANIFEST) {
      setTimeout(() => updater.check(true), 4000)
      setInterval(() => updater.check(true), 6 * 3600 * 1000)
    }
    // `--snapshot out.png` renders the window to a file and quits (headless UI check)
    const i = process.argv.indexOf('--snapshot')
    if (i > 0 && process.argv[i + 1]) setTimeout(async () => {
      fs.writeFileSync(process.argv[i + 1], (await win.webContents.capturePage()).toPNG())
      app.quit()
    }, Number(process.env.ARGO_SNAPSHOT_DELAY || 6) * 1000)
  })
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    for (const t of terms.values()) if (!t.exited) try { t.proc.kill() } catch {}
    if (ps) try { ps.kill() } catch {}
    // the orchestrator keeps running so work in progress is not lost
  })
}
