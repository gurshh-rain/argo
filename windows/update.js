// In-app updates, as in the Mac app. Each GitHub release carries the Windows zip and a `latest-win.json`
// manifest holding an Ed25519 signature over the zip, made with the release key whose public half is
// below. A download that was not signed by us is refused before anything is installed.
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RELEASE_MANIFEST = 'https://github.com/gurshh-rain/argo/releases/latest/download/latest-win.json'
// Public half of the release signing key (the same key the Mac app trusts; mac/argo-sign.swift keygen).
const PUBLIC_KEY = 'yX667KtbwoXFB9RJbCy5zMvNJlRnsU7+sMJNQ8fs3vg='

// Numeric comparison of dotted versions: 0.1.10 is newer than 0.1.9.
function isNewer(a, b) {
  const parse = (s) => String(s).trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const x = parse(a), y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

function verify(file, signature, publicKey = PUBLIC_KEY) {
  let key, sig
  try {
    const raw = Buffer.from(publicKey, 'base64')
    sig = Buffer.from(signature, 'base64')
    if (raw.length !== 32 || sig.length !== 64) throw new Error('bad length')
    // a raw Ed25519 public key wrapped in its fixed SPKI header
    key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
  } catch { throw new Error("Update signing isn't configured for this build.") }
  if (!crypto.verify(null, fs.readFileSync(file), key, sig)) throw new Error("The download's signature did not match, so it was not installed.")
}

// The helper waits for this process to exit, swaps the app folder, and opens the new copy. The old folder
// is only removed once the new one is in position, so a failed swap leaves Argo installed.
// It is PowerShell using only its own commands, with the paths handed over in the environment so that it
// holds nothing cmd or PowerShell would need quoted.
const SWAP = ['$ErrorActionPreference = [System.Management.Automation.ActionPreference]::SilentlyContinue',
  'Wait-Process -Id $env:ARGO_SWAP_PID -Timeout 60',
  // helper processes may hold the folder for a moment after the app has gone
  '$moved = $false',
  'for ($n = 0; $n -lt 30 -and -not $moved; $n++) { try { Move-Item -LiteralPath $env:ARGO_SWAP_DEST -Destination $env:ARGO_SWAP_OLD -ErrorAction Stop; $moved = $true } catch { Start-Sleep -Seconds 1 } }',
  'if ($moved) { try { Move-Item -LiteralPath $env:ARGO_SWAP_NEW -Destination $env:ARGO_SWAP_DEST -ErrorAction Stop; Remove-Item -LiteralPath $env:ARGO_SWAP_OLD -Recurse -Force } catch { Move-Item -LiteralPath $env:ARGO_SWAP_OLD -Destination $env:ARGO_SWAP_DEST } }',
  'Remove-Item -LiteralPath $env:ARGO_SWAP_STAGE -Recurse -Force',
  '$exe = $env:ARGO_SWAP_EXE',
  'Remove-Item Env:ARGO_SWAP_*',
  'Start-Process -FilePath $exe'].join('; ')

// Starts the helper so that it outlives this process and never shows a window. Node ends the children it
// started when it exits, unless they are detached, and a detached child has no console: PowerShell will not
// run without one, and every console program a batch file calls opens a console window of its own. So a
// hidden cmd is started the ordinary way and it starts PowerShell, which shares the hidden console and is
// not ended with us.
function startSwap(pid, dest, fresh, stage, exe = path.basename(process.execPath)) {
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return spawn(process.env.ComSpec || path.join(system, 'cmd.exe'), ['/d', '/s', '/c', `"start "" /b "${powershell}" -NoLogo -NoProfile -NonInteractive -Command ${SWAP}"`], {
    // from the temp folder: a helper whose working directory is the app folder would itself keep it from being moved
    cwd: os.tmpdir(), stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
    env: { ...process.env, ARGO_SWAP_PID: String(pid), ARGO_SWAP_DEST: dest, ARGO_SWAP_NEW: fresh, ARGO_SWAP_OLD: `${dest}.old-${pid}`, ARGO_SWAP_STAGE: stage, ARGO_SWAP_EXE: path.join(dest, exe) },
  })
}

// `app`: Electron's app. `emit(state)`: tell the window. `beforeQuit()`: stop whatever runs out of the app folder.
function createUpdater({ app, emit, beforeQuit }) {
  let state = { phase: 'idle' }, pending = null
  const set = (s) => { state = s; emit(state) }
  const busy = () => ['checking', 'downloading', 'installing'].includes(state.phase)
  const manifestURL = () => process.env.ARGO_UPDATE_MANIFEST || RELEASE_MANIFEST

  // `silent` is the check at launch: no error is shown if GitHub cannot be reached.
  async function check(silent = false) {
    if (busy()) return
    set({ phase: 'checking' })
    pending = null
    try {
      const res = await fetch(manifestURL(), { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(res.status === 404 ? 'The latest release has no Windows update manifest yet.' : `GitHub answered ${res.status}. Try again later.`)
      const m = await res.json()
      if (!m || typeof m.version !== 'string' || typeof m.url !== 'string' || typeof m.signature !== 'string') throw new Error('The update manifest is malformed.')
      if (isNewer(m.version, app.getVersion())) {
        pending = m
        set({ phase: 'available', version: m.version, notes: m.notes || '' })
        if (process.env.ARGO_UPDATE_AUTOINSTALL) install()
      } else set({ phase: 'upToDate' })
    } catch (e) {
      set(silent ? { phase: 'idle' } : { phase: 'failed', message: `Couldn't check for updates: ${e.message}` })
    }
  }

  async function download(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
    if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`)
    const total = Number(res.headers.get('content-length')) || 0
    const file = path.join(os.tmpdir(), `argo-update-${crypto.randomUUID()}.zip`)
    const out = fs.createWriteStream(file)
    let got = 0, shown = -1
    for await (const chunk of res.body) {
      got += chunk.length
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      const pct = total ? Math.round((got / total) * 100) : 0
      if (pct !== shown) set({ phase: 'downloading', pct: (shown = pct) })
    }
    await new Promise((ok, bad) => out.end((err) => (err ? bad(err) : ok())))
    return file
  }

  async function install() {
    const m = pending
    if (!m || busy()) return
    let stage
    try {
      if (process.platform !== 'win32' || !app.isPackaged) throw new Error('This copy of Argo is not a packaged Windows build.')
      const dest = path.dirname(process.execPath), parent = path.dirname(dest)
      try { fs.accessSync(parent, fs.constants.W_OK) } catch { throw new Error(`Argo can't write to ${parent}. Move the Argo folder somewhere you own and try again.`) }
      set({ phase: 'downloading', pct: 0 })
      const zip = await download(m.url)
      verify(zip, m.signature)
      set({ phase: 'installing' })
      // what an update that never finished left behind
      for (const f of fs.readdirSync(parent)) if (/^\.argo-update-\d+$/.test(f)) fs.rmSync(path.join(parent, f), { recursive: true, force: true })
      // unpacked beside the app, so the swap is a rename on the same drive
      stage = path.join(parent, `.argo-update-${process.pid}`)
      fs.rmSync(stage, { recursive: true, force: true })
      fs.mkdirSync(stage, { recursive: true })
      await new Promise((ok, bad) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', stage], { windowsHide: true }, (err) => (err ? bad(new Error('Could not unpack the download.')) : ok())))
      fs.rmSync(zip, { force: true })
      const exe = path.basename(process.execPath)
      const fresh = [stage, ...fs.readdirSync(stage).map((d) => path.join(stage, d))].find((d) => fs.existsSync(path.join(d, exe)))
      if (!fresh || fresh === stage) throw new Error("The download didn't contain the app.")
      // a copy put there by the installer keeps its uninstaller, so it can still be removed from Windows Settings
      for (const f of fs.readdirSync(dest)) if (/^Uninstall .*.exe$/i.test(f)) fs.copyFileSync(path.join(dest, f), path.join(fresh, f))
      await beforeQuit()
      // not waited for beyond its start: it waits on us
      await new Promise((ok, bad) => startSwap(process.pid, dest, fresh, stage).on('error', () => bad(new Error('Could not start the installer.'))).on('exit', ok))
      app.exit(0)
    } catch (e) {
      if (stage) fs.rmSync(stage, { recursive: true, force: true })
      set({ phase: 'failed', message: `The update could not be installed: ${e.message}` })
    }
  }

  return { check, install, state: () => state }
}

module.exports = { createUpdater, isNewer, verify, startSwap, PUBLIC_KEY }
