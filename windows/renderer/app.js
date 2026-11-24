// Argo for Windows: the window. Talks to the local orchestrator through the preload bridge.
const $ = (id) => document.getElementById(id)
const real = (k) => k !== null && k !== undefined && k !== false && k !== ''
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== false && v !== null) e.setAttribute(k, v === true ? '' : v)
  }
  e.append(...kids.flat(Infinity).filter(real))
  return e
}
// Replaces an element's content only when it would look different. The window is repainted on every poll;
// leaving unchanged parts alone keeps hover, scroll position and half-finished clicks intact. Handlers on
// the kept nodes must therefore read current state when they run, not capture it when they are built.
function paint(el, ...kids) {
  const tmp = document.createElement('div')
  tmp.append(...kids.flat(Infinity).filter(real))
  const html = tmp.innerHTML
  if (el._html === html) return
  el._html = html
  el.replaceChildren(...tmp.childNodes)
}
const ICONS = {
  plus: 'M8 3.5v9M3.5 8h9', x: 'M4.5 4.5l7 7M11.5 4.5l-7 7', sidebar: 'M2.5 3.5h11v9h-11zM6 3.5v9', panel: 'M2.5 3.5h11v9h-11zM10 3.5v9',
  bell: 'M4.5 11.5v-4a3.5 3.5 0 0 1 7 0v4l1 1h-9zM7 14.2h2', left: 'M13 8H3.5M7.5 4l-4 4 4 4', right: 'M3 8h9.5M8.5 4l4 4-4 4', up: 'M8 13V3.5M4 7.5l4-4 4 4',
  folder: 'M2 4.5h4l1.5 1.5H14v6.5H2z', file: 'M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12', term: 'M2 3.5h12v9H2zM4.5 6.5l2 1.5-2 1.5M8 10h3',
  splitR: 'M2 3.5h12v9H2zM8 3.5v9', splitD: 'M2 3.5h12v9H2zM2 8h12', search: 'M7 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zM10.5 10.5L14 14',
  reload: 'M13 8a5 5 0 1 1-1.6-3.6M13 2.5v2.6h-2.6', open: 'M6.5 3.5h-3v9h9v-3M9 3h4v4M13 3L7.5 8.5', layout: 'M2.5 2.5h11v11h-11zM8 2.5v11M2.5 8h11',
  branch: 'M5 2.5v11M11 2.5v3c0 3-6 2-6 5', gear: 'M3 5h6M11 5h2M3 11h2M7 11h6M10 3.5v3M6 9.5v3', phone: 'M5 1.5h6v13H5zM7.4 12.5h1.2',
  clip: 'M12 7.5l-4.6 4.6a2.5 2.5 0 0 1-3.5-3.5L9 3.5a1.8 1.8 0 0 1 2.5 2.5L6.6 11', chevR: 'M6 3.5L10.5 8 6 12.5', chevD: 'M3.5 6L8 10.5 12.5 6', chevU: 'M3.5 10L8 5.5 12.5 10',
  check: 'M3 8.5l3.5 3.5L13 4.5', cross: 'M4 4l8 8M12 4l-8 8', mail: 'M2 4h12v8.5H2zM2 4.5l6 4.5 6-4.5', pin: 'M8 14V9.5M5 9.5h6L10 6V2.5H6V6z',
  wait: 'M4.5 2.5h7l-3.5 5.5 3.5 5.5h-7l3.5-5.5z', list: 'M2.5 4.5l1 1 2-2M2.5 10.5l1 1 2-2M8 4.5h5.5M8 10.5h5.5', play: 'M5 3l8 5-8 5z',
  down: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10', sun: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z', half: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 2.5v11', menu: 'M3 4.5h10M3 8h10M3 11.5h10',
  reply: 'M6.5 4L3 7.5 6.5 11M3 7.5h6a4 4 0 0 1 4 4v1',
}
function icon(name, size = 14) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('class', 'ic')
  p.setAttribute('d', ICONS[name]); s.append(p)
  return s
}
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v))
const pretty = (s) => String(s || '').replace(/_/g, ' ')
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const cap = (s) => String(s || '').replace(/(^|\s)\S/g, (c) => c.toUpperCase())
const KINDS = [['claude', 'Claude'], ['devin', 'Devin'], ['codex', 'Codex'], ['ollama', 'Ollama'], ['shell', 'Shell']]
const AGENT_KINDS = ['claude', 'devin', 'codex', 'ollama']

const S = {
  info: { home: '', platform: 'win32', version: '', msg: 'argo-msg', packaged: false, demo: {} },
  state: null, error: null, logs: {},
  project: load('project', ''), workspaces: load('workspaces', []), names: load('names', {}), descriptions: load('descriptions', {}),
  owner: load('owner', {}), selectedRun: null, hidden: new Set(), openPanes: new Set(), closedPanes: new Set(),
  rightTab: 'Files', rightHidden: false, sidebarHidden: false, forceNew: false,
  expanded: new Set(), selectedFile: null, dirs: {}, searching: false, filter: '',
  layouts: {}, opened: new Set(), focused: null, ring: new Set(), wantFocus: false,
  worktrees: [], wtAt: 0, attachments: [], update: { phase: 'idle' }, onUpdate: null,
  seen: new Set(), reported: new Set(), primed: false,
}
const terms = new Map()
const folderOf = (ws) => (!ws || ws.startsWith('ws:') ? '' : ws)
const base = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p
const tilde = (p) => (S.info.home && p.startsWith(S.info.home) ? '~' + p.slice(S.info.home.length) : p)
const fileManager = () => (S.info.platform === 'win32' ? 'Explorer' : S.info.platform === 'darwin' ? 'Finder' : 'Files')
const nameOf = (ws) => S.names[ws] || (folderOf(ws) ? base(ws) : 'No project')
const wsOfRun = (r) => { const o = S.owner[r.id]; return o !== undefined && (S.workspaces.includes(o) || o === S.project) ? o : /[\\/]\.argo[\\/]workspaces[\\/]/.test(r.project) ? '' : r.project }
const runsIn = (ws) => (S.state?.runs || []).filter((r) => wsOfRun(r) === ws)
const runById = (id) => (S.state?.runs || []).find((r) => r.id === id)
const run = () => runById(S.selectedRun)
const agent = (id) => (S.state?.agents || []).find((a) => a.id === id)
const usable = (kind) => kind === 'shell' || !!agent(kind)?.installed
const eff = (t) => t.ranWith || { agent: t.override?.agent || t.auto.agent, model: t.override?.model ?? t.auto.model, reasoning: t.override?.reasoning || t.auto.reasoning }
const inTerminal = (t) => !!t.delegate || (!!t.terminal && t.status === 'done')
const canOverride = (t) => ['pending', 'failed', 'needs_attention'].includes(t.status)
const isActive = (r) => ['planning', 'running', 'verifying'].includes(r.status)
const hasRepo = (r) => r.isolated !== false
const attn = (runId, taskId) => (S.state?.attention || []).filter((a) => a.runId === runId && a.kind !== 'completed' && (!taskId || a.taskId === taskId))
const termsIn = (ws) => [...terms.values()].filter((t) => t.ws === ws)
const workspaceList = () => { const out = []; for (const w of [...S.workspaces, S.project, ...(S.state?.runs || []).map(wsOfRun), ...[...terms.values()].map((t) => t.ws)]) if (!out.includes(w)) out.push(w); return out }
const agClass = (id) => 'ag-' + (AGENT_KINDS.includes(id) ? id : 'none')
const api = (m, route, body) => window.argo.api(m, route, body)
const act = async (fn) => { try { await fn(); await refresh() } catch (e) { alertBox(clean(e)) } }
// Electron prefixes errors that crossed from the main process; the user only needs the message
const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------- dialogs and menus
let modalClosed = null
function modal(node, onClose) { closeModal(); modalClosed = onClose || null; $('modal').replaceChildren(node); $('modal').hidden = false }
function closeModal() { $('modal').hidden = true; $('modal').replaceChildren(); const f = modalClosed; modalClosed = null; f?.() }
function alertBox(text) {
  const ok = h('button', { class: 'btn primary large', onclick: closeModal }, 'OK')
  modal(h('div', { class: 'dialog' }, h('h3', {}, 'Argo'), h('p', {}, text), h('div', { class: 'foot' }, ok)))
  ok.focus()
}
function confirmBox(title, text, label, fn) {
  const go = h('button', { class: 'btn primary large', onclick: () => { closeModal(); fn() } }, label)
  modal(h('div', { class: 'dialog' }, h('h3', {}, title), h('p', { class: 'dim' }, text), h('div', { class: 'foot' }, h('button', { class: 'btn large', onclick: closeModal }, 'Cancel'), go)))
  go.focus()
}
function promptBox(title, value, note, label, fn) {
  const input = h('input', { type: 'text', class: 'full', value })
  const ok = () => { closeModal(); fn(input.value) }
  input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && ok())
  modal(h('div', { class: 'dialog' }, h('h3', {}, title), note && h('p', { class: 'dim' }, note), h('div', { class: 'line' }, input), h('div', { class: 'foot' }, h('button', { class: 'btn large', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary large', onclick: ok }, label))))
  input.focus(); input.select()
}
const closeMenus = () => document.querySelectorAll('.menu').forEach((m) => m.remove())
// items: { label, run, disabled, hint } | { label, sub: [...] } | { head } | '-'
function menu(ev, items) {
  ev.preventDefault(); ev.stopPropagation()
  closeMenus()
  // a click opens the menu under its button; a right-click opens it at the pointer
  const box = ev.type === 'click' && ev.currentTarget?.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : null
  const x = box ? box.left : ev.clientX, y = box ? box.bottom + 2 : ev.clientY
  const m = h('div', { class: 'menu' })
  const place = () => { m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px' }
  const fill = (list) => m.replaceChildren(...list.filter(Boolean).map((it) => it === '-' ? h('hr') : it.head ? h('div', { class: 'head' }, it.head)
    : h('button', { disabled: it.disabled, onclick: (e) => { e.stopPropagation(); if (it.sub) { fill(it.sub); place() } else { m.remove(); it.run() } } }, h('span', {}, it.label), it.hint && h('kbd', {}, it.hint), it.sub && h('kbd', {}, '›'))))
  fill(items)
  m.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation() })
  document.body.append(m)
  place()
}
addEventListener('click', closeMenus)
addEventListener('contextmenu', closeMenus)
addEventListener('blur', closeMenus)

// ---------- workspaces
function select(ws) {
  S.project = ws; save('project', ws)
  if (ws && !S.workspaces.includes(ws)) { S.workspaces.push(ws); save('workspaces', S.workspaces) }
  S.selectedRun = runsIn(ws).find((r) => !S.hidden.has(r.id))?.id || null
  if (!S.selectedRun && S.rightTab !== 'Usage') S.rightTab = 'Files'
  S.dirs = {}; S.expanded.clear(); S.selectedFile = null; S.worktrees = []; S.logs = {}; S.wantFocus = true
  openFirst(); render(true)
  loadWorktrees()
  if (S.selectedRun) refresh()
}
function newWorkspace() {
  const key = 'ws:' + Math.random().toString(16).slice(2, 10)
  S.names[key] = 'Workspace ' + (S.workspaces.filter((w) => w.startsWith('ws:')).length + 1); save('names', S.names)
  select(key)
}
async function openFolder() { const p = await window.argo.chooseFolder(); if (p) select(p) }
function step(by) { const list = workspaceList(), i = list.indexOf(S.project); if (i >= 0 && list[i + by] !== undefined) select(list[i + by]) }
function rename(ws) { promptBox('Rename workspace', nameOf(ws), '', 'Rename', (v) => { if (v.trim()) S.names[ws] = v.trim(); else delete S.names[ws]; save('names', S.names); render() }) }
function describe(ws, text) { if (text.trim()) S.descriptions[ws] = text.trim().slice(0, 200); else delete S.descriptions[ws]; save('descriptions', S.descriptions); render() }
function deleteWorkspace(ws) {
  const rs = runsIn(ws).length, ts = termsIn(ws).length
  confirmBox(`Delete the workspace "${nameOf(ws)}"?`, `This closes its ${plural(ts, 'terminal')} and deletes its ${plural(rs, 'run')} with their records.` + (folderOf(ws) ? ' The folder and its files are not touched; branches with unmerged work are kept.' : ''), 'Delete workspace', () => act(async () => {
    for (const t of termsIn(ws)) closeTerm(t.id)
    for (const r of runsIn(ws)) { await api('DELETE', 'runs/' + r.id); delete S.owner[r.id] }
    S.workspaces = S.workspaces.filter((w) => w !== ws); save('workspaces', S.workspaces)
    delete S.names[ws]; delete S.descriptions[ws]; save('names', S.names); save('descriptions', S.descriptions); save('owner', S.owner)
    S.opened.delete(ws)
    if (S.project === ws) select(S.workspaces[0] || '')
  }))
}
function showRun(id) { S.hidden.delete(id); if (S.selectedRun !== id) S.logs = {}; S.selectedRun = id; refresh() }
// Closes the run's panes without deleting it; it stays in the run strip.
function hideRun() { if (S.selectedRun) S.hidden.add(S.selectedRun); S.selectedRun = null; S.logs = {}; if (S.rightTab !== 'Usage') S.rightTab = 'Files'; render(true) }
// The bell jumps to the most recent run that needs attention.
function jumpToAttention() {
  const all = S.state?.attention || [], a = [...all].reverse().find((x) => x.kind !== 'completed') || all[all.length - 1]
  if (!a) return
  const r = runById(a.runId)
  if (r && wsOfRun(r) !== S.project) select(wsOfRun(r))
  showRun(a.runId)
}
// Focus the pane that rang its bell, else the run that needs attention.
function jumpToUnread() { const id = [...S.ring].find((x) => terms.has(x)); if (id) focusTerm(id); else jumpToAttention() }
const needsCount = () => (S.state?.runs || []).reduce((n, r) => n + attn(r.id).length, 0) + [...S.ring].filter((id) => terms.has(id)).length

// ---------- worktrees you open yourself
async function loadWorktrees(fetch) {
  const folder = folderOf(S.project)
  S.wtAt = Date.now()
  if (!folder || !S.state) { S.worktrees = []; return }
  try {
    const list = await api('GET', `worktrees?project=${encodeURIComponent(folder)}${fetch ? '&fetch=1' : ''}`)
    if (folderOf(S.project) === folder) { S.worktrees = list; render() }
  } catch {}
}
// Creates a worktree from the latest remote code and opens that kind of terminal in it.
const newWorktree = (kind) => act(async () => {
  const ws = S.project, w = await api('POST', 'worktrees', { project: folderOf(ws) })
  addTerm(kind, ws, { tree: w })
  await loadWorktrees()
  if (w.note) alertBox(w.note)
})
const pullWorktree = (w) => act(async () => {
  const r = await api('POST', 'worktrees/pull', { project: folderOf(S.project), path: w.path })
  await loadWorktrees()
  alertBox(r.pulled ? `Pulled ${r.pulled} new commit(s) from ${w.upstream || 'the remote'} into ${w.name}.` : `${w.name} already has everything on ${w.upstream || 'the remote'}.`)
})
const removeWorktree = (w) => act(async () => {
  const ws = S.project, g = await api('POST', 'worktrees/remove', { project: folderOf(ws), path: w.path, force: true })
  for (const t of termsIn(ws)) if (t.worktree === w.name) closeTerm(t.id)
  await loadWorktrees()
  if (g.keptBranch) alertBox(`Removed ${w.name}. Its branch ${g.keptBranch} has commits that are not on the remote, so it was kept.`)
})

// ---------- terminals and their split layout
const insert = (n, target, id, horiz) => {
  if (n.leaf) return n.leaf === target ? { h: horiz, kids: [n, { leaf: id }], w: [1, 1] } : n
  const i = n.kids.findIndex((k) => k.leaf === target)
  // splitting along the axis the parent already uses just adds a sibling
  if (n.h === horiz && i >= 0) { n.kids.splice(i + 1, 0, { leaf: id }); n.w.splice(i + 1, 0, 1); return n }
  n.kids = n.kids.map((k) => insert(k, target, id, horiz)); return n
}
const remove = (n, id) => {
  if (n.leaf) return n.leaf === id ? null : n
  const keep = n.kids.map((k, i) => [remove(k, id), n.w[i]]).filter(([k]) => k)
  if (!keep.length) return null
  if (keep.length === 1) return keep[0][0]
  n.kids = keep.map(([k]) => k); n.w = keep.map(([, w]) => w); return n
}
const termTheme = () => document.documentElement.classList.contains('light')
  ? { background: '#f7f7f7', foreground: '#1f1f1f', cursor: '#000', cursorAccent: '#f7f7f7', selectionBackground: '#007aff44' }
  : { background: '#1e1e1e', foreground: '#ebebeb', cursor: '#fff', cursorAccent: '#1e1e1e', selectionBackground: '#007aff66' }
// Opens a terminal. It splits off `beside` (default: the focused pane), to the right or below.
// `tree`: a worktree to work in instead of the project checkout; defaults to the worktree of the pane it splits from.
function addTerm(kind, ws, { beside, horiz = true, place = true, tree } = {}) {
  const label = KINDS.find((k) => k[0] === kind)?.[1] || kind
  const n = Math.max(0, ...termsIn(ws).filter((t) => t.kind === kind).map((t) => Number(t.name.split(' ').pop()) || 0)) + 1
  const id = 't' + Math.random().toString(36).slice(2, 9)
  const from = beside && terms.get(beside)
  const el = h('div', { class: 'term' })
  const term = new Terminal({ fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace', fontSize: 12.5, cursorBlink: true, allowProposedApi: true, scrollback: 5000, theme: termTheme() })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit); term.open(el)
  const t = { id, name: `${label} ${n}`, kind, ws, cwd: tree?.path || (from?.worktree ? from.cwd : folderOf(ws) || S.info.home), worktree: tree?.name || from?.worktree || null,
    term, fit, el, exited: false, mail: null, cli: AGENT_KINDS.includes(kind) ? kind : null }
  terms.set(id, t)
  term.onData((d) => window.argo.pty.write(id, d))
  term.onResize(({ cols, rows }) => window.argo.pty.resize(id, cols, rows))
  term.onBell(() => { if (S.focused !== id && !S.ring.has(id)) { S.ring.add(id); render() } })
  // copy and paste as in Windows Terminal: Ctrl+C copies when text is selected, Ctrl+V pastes (the browser's own paste event does the work)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true
    if (e.code === 'KeyC' && (e.shiftKey || (S.info.platform === 'win32' && term.hasSelection()))) {
      if (term.hasSelection()) { window.argo.copy(term.getSelection()); term.clearSelection() }
      e.preventDefault()
      return false
    }
    if (e.code === 'KeyV' && (e.shiftKey || S.info.platform === 'win32')) return false
    return true
  })
  el.addEventListener('contextmenu', (e) => menu(e, [
    { label: 'Copy', hint: 'Ctrl+Shift+C', disabled: !term.hasSelection(), run: () => window.argo.copy(term.getSelection()) },
    { label: 'Paste', hint: 'Ctrl+Shift+V', disabled: t.exited, run: async () => { term.paste(await window.argo.paste()); term.focus() } },
    { label: 'Select all', run: () => term.selectAll() }, { label: 'Clear', run: () => term.clear() }, '-',
    { label: 'Split right', run: () => addTerm('shell', t.ws, { beside: id, horiz: true }) }, { label: 'Split down', run: () => addTerm('shell', t.ws, { beside: id, horiz: false }) },
    { label: 'Close terminal', run: () => closeTerm(id) },
  ]))
  if (place) {
    const mine = termsIn(ws).filter((x) => x.id !== id).map((x) => x.id)
    const target = beside || (mine.includes(S.focused) ? S.focused : mine[mine.length - 1])
    S.layouts[ws] = target && S.layouts[ws] ? insert(S.layouts[ws], target, id, horiz) : { leaf: id }
  }
  S.focused = id; S.wantFocus = true
  window.argo.pty.create({ id, name: t.name, kind, cwd: t.cwd, workspace: ws, worktree: t.worktree, cols: 100, rows: 30 })
    .then((r) => { if (r?.error) throw new Error(r.error) })
    .catch((e) => { term.write(`\x1b[31m${clean(e)}\x1b[0m\r\n`); t.exited = true; t.cli = null; render() })
  if (place) render(true)
  return id
}
function closeTerm(id) {
  const t = terms.get(id); if (!t) return
  window.argo.pty.kill(id); t.term.dispose(); terms.delete(id); S.ring.delete(id)
  S.layouts[t.ws] = S.layouts[t.ws] ? remove(S.layouts[t.ws], id) : null
  if (S.focused === id) { S.focused = termsIn(t.ws).pop()?.id || null; S.wantFocus = true }
  render(true)
}
function focusTerm(id) {
  const t = terms.get(id); if (!t) return
  if (t.ws !== S.project) select(t.ws)
  S.focused = id; S.ring.delete(id); t.mail = null; S.wantFocus = true
  render(true)
}
const focusedTerm = () => { const t = terms.get(S.focused); return t && t.ws === S.project ? t : null }
// The keyboard split opens the same kind of terminal as the focused one, beside it.
function splitFocused(horiz) { const t = focusedTerm(), kind = t && usable(t.kind) ? t.kind : 'shell'; addTerm(kind, S.project, { beside: t?.id, horiz }) }
function movePane(by) { const list = termsIn(S.project); if (!list.length) return; const i = list.findIndex((t) => t.id === S.focused); focusTerm(list[(i + by + list.length) % list.length].id) }
window.argo.pty.onData((id, data) => terms.get(id)?.term.write(data))
window.argo.pty.onExit((id) => { const t = terms.get(id); if (t) { t.exited = true; t.cli = null; render() } })
window.argo.onCLI((map) => { let changed = false; for (const t of terms.values()) if (!t.exited && id2cli(map, t) !== t.cli) { t.cli = id2cli(map, t); changed = true } if (changed) render() })
const id2cli = (map, t) => (t.id in map ? map[t.id] || null : t.cli)
window.argo.onMail((id, from, text) => { const t = terms.get(id); if (!t) return; t.mail = `${from}: ${text}`; if (S.focused !== id) S.ring.add(id); render() })

// default layout: the saved arrangement, or one shell
const capture = (n) => !n ? null : n.leaf ? (terms.get(n.leaf) ? { kind: terms.get(n.leaf).kind } : null) : { h: n.h, items: n.kids.map(capture), w: n.w.slice() }
const countOf = (t) => !t ? 0 : t.kind ? 1 : (t.items || []).reduce((s, x) => s + countOf(x), 0)
function applyTemplate(tpl, ws) {
  const build = (t) => {
    if (!t) return null
    if (t.kind) return { leaf: addTerm(KINDS.some((k) => k[0] === t.kind) && usable(t.kind) ? t.kind : 'shell', ws, { place: false }) }
    const made = (t.items || []).map((x, i) => [build(x), Math.max(0.05, Number(t.w?.[i]) || 1)]).filter(([k]) => k)
    return !made.length ? null : made.length === 1 ? made[0][0] : { h: t.h !== false, kids: made.map(([k]) => k), w: made.map(([, w]) => w) }
  }
  const tree = build(tpl)
  if (tree) S.layouts[ws] = tree
  S.focused = termsIn(ws)[0]?.id || null; S.wantFocus = true
  render(true)
}
// Each workspace starts with the default layout (one shell unless you saved another). Only once, so closing terminals does not bring them back.
function openFirst() {
  const ws = S.project
  if (!S.state || S.opened.has(ws) || termsIn(ws).length) return
  S.opened.add(ws)
  if (S.info.demo.team) return ['claude', 'devin', 'shell'].forEach((k) => addTerm(usable(k) ? k : 'shell', ws, { horiz: k !== 'shell' }))
  const tpl = load('defaultLayout', null)
  if (tpl && countOf(tpl)) applyTemplate(tpl, ws); else addTerm('shell', ws)
}

// ---------- polling and dispatch
let refreshing = null, queued = null
// One refresh at a time. Asked for while one is under way, it answers with the next one, so the caller
// never gets state that was fetched before its own change.
function refresh() {
  if (refreshing) return (queued ||= refreshing.then(() => { queued = null; return refresh() }))
  refreshing = poll().finally(() => { refreshing = null })
  return refreshing
}
async function poll() {
  try {
    const s = await api('GET', 'state')
    S.state = s; S.error = null
    if (!S.project && !S.workspaces.length && s.projects[0] && localStorage.getItem('project') === null) { S.project = s.projects[0]; S.workspaces.push(S.project); save('workspaces', S.workspaces) }
    // show the newest run of this workspace unless the user closed its panes
    const mine = runsIn(S.project)
    if (!mine.some((r) => r.id === S.selectedRun)) { S.selectedRun = mine.find((r) => !S.hidden.has(r.id))?.id || null; S.logs = {} }
    // when a run's report arrives, bring it up once
    const r = run()
    if (r?.report && !S.reported.has(r.id)) { if (S.primed) { S.rightTab = 'Report'; S.rightHidden = false } S.reported.add(r.id) }
    if (!S.primed) for (const x of s.runs) if (x.report) S.reported.add(x.id)
    for (const a of s.attention) if (!S.seen.has(a.id)) { S.seen.add(a.id); if (S.primed) window.argo.notify(a.kind === 'completed' ? 'Run finished' : 'An agent needs you', a.spoken || a.message) }
    S.primed = true
    const id = S.selectedRun
    if (id) { const l = await api('GET', `runs/${id}/logs?tail=400`); if (S.selectedRun === id) S.logs = l }
    openFirst()
    // check the remote every minute, so a teammate's push shows up as "behind" on the worktree panes
    if (Date.now() - S.wtAt > 60_000) loadWorktrees(true)
    await dispatch()
  } catch (e) {
    // the orchestrator answers but refuses us (for instance another copy with a different token): say so rather than show nothing
    S.error = (await window.argo.ensure().catch(clean)) || (S.state ? null : clean(e))
  }
  render()
  updateTray()
}
// Gives each subtask that is waiting for a terminal to a free one running the right CLI, and types the assignment into it.
async function dispatch() {
  const type = (id, s, ms) => new Promise((res) => setTimeout(() => { window.argo.pty.write(id, s); res() }, ms))
  for (const r of S.state.runs.filter(isActive)) {
    const ws = wsOfRun(r), alive = () => termsIn(ws).filter((t) => !t.exited)
    // a terminal is busy while a subtask it was given has not reported back
    const busy = new Set(runsIn(ws).flatMap((x) => x.tasks).filter((t) => t.delegate?.state === 'sent').map((t) => t.terminal))
    // a subtask whose terminal has gone away is offered to another terminal
    for (const t of r.tasks.filter((t) => t.delegate?.state === 'sent')) if (!alive().some((x) => x.name === t.terminal)) await api('POST', `runs/${r.id}/tasks/${t.id}/requeue`).catch(() => {})
    for (const t of r.tasks.filter((t) => t.delegate?.state === 'waiting')) {
      const a = eff(t), target = alive().find((x) => x.cli === a.agent && !busy.has(x.name))
      if (!target) continue
      busy.add(target.name)
      const c = await api('POST', `runs/${r.id}/tasks/${t.id}/claim`, { terminal: target.name }).catch(() => null)
      if (!c) continue
      // Claude Code can switch model mid-session, so the difficulty-based model applies in a terminal too
      if (a.agent === 'claude' && a.model) { await type(target.id, '/model ' + a.model, 0); await type(target.id, '\r', 300); await type(target.id, '', 1200) }
      await type(target.id, c.line, 0); await type(target.id, '\r', 400)
    }
  }
}
let trayJson = ''
function updateTray() {
  const s = { needs: needsCount(), kinds: KINDS.map(([id, label]) => ({ id, label, enabled: usable(id) })),
    workspaces: workspaceList().map((ws) => ({ key: ws, name: nameOf(ws), terms: termsIn(ws).map((t) => ({ id: t.id, name: t.name, ring: S.ring.has(t.id), exited: t.exited })) })) }
  const j = JSON.stringify(s)
  if (j !== trayJson) { trayJson = j; window.argo.tray(s) }
}

// ---------- rendering
function render(force) {
  renderSidebar(); renderTop(); renderStrip(); renderChips(); renderBanners(); renderStage(force); renderApprove(); renderComposer(); renderRight()
}
const termItems = (beside) => KINDS.map(([id, label]) => ({ label: `New ${label} terminal`, disabled: !usable(id), run: () => addTerm(id, S.project, { beside }) }))
// The row of controls at the top of the sidebar: sidebar, notifications, new, back, forward, all commands.
function tools() {
  const waiting = (S.state?.attention || []).filter((a) => a.kind !== 'completed').length
  return [
    h('button', { class: 'icon', title: 'Hide or show the sidebar (Ctrl+Shift+B)', onclick: () => commands.toggleSidebar() }, icon('sidebar')),
    h('button', { class: 'icon' + (waiting ? ' hot' : ''), title: waiting ? `${plural(waiting, 'agent')} waiting for you` : 'No notifications', onclick: jumpToAttention }, icon('bell')),
    h('button', { class: 'icon', title: 'New workspace or terminal', onclick: (e) => menu(e, [{ label: 'New workspace', hint: 'Ctrl+Shift+N', run: newWorkspace }, { label: 'Open folder as workspace…', hint: 'Ctrl+Shift+O', run: openFolder }, '-', ...termItems()]) }, icon('plus')),
    h('button', { class: 'icon', title: 'Previous workspace', onclick: () => step(-1) }, icon('left')),
    h('button', { class: 'icon', title: 'Next workspace', onclick: () => step(1) }, icon('right')),
    h('button', { class: 'icon', title: 'All commands and their shortcuts', onclick: commandMenu }, icon('menu')),
  ]
}
function wsTab(ws) {
  const rs = runsIn(ws), ts = termsIn(ws), needs = rs.flatMap((r) => attn(r.id)), active = rs.filter(isActive).length, ringing = ts.some((t) => S.ring.has(t.id))
  const counts = [ts.length ? plural(ts.length, 'terminal') : '', active ? `${active} running` : ''].filter(Boolean).join(' · ')
  const where = folderOf(ws) ? tilde(ws) : 'no folder'
  return h('button', { class: 'ws' + (ws === S.project ? ' on' : '') + (needs.length || ringing ? ' attn' : ''), title: folderOf(ws) || 'A workspace without a folder: terminals start in your home folder', onclick: () => select(ws),
    oncontextmenu: (e) => menu(e, [
      { label: 'Rename…', run: () => rename(ws) },
      { label: S.descriptions[ws] ? 'Edit description…' : 'Add description…', run: () => promptBox('Workspace description', S.descriptions[ws] || '', "A short note shown on the workspace's tab.", 'Save', (v) => describe(ws, v)) },
      S.descriptions[ws] && { label: 'Remove description', run: () => describe(ws, '') },
      folderOf(ws) && { label: `Show in ${fileManager()}`, run: () => window.argo.open(ws) },
      '-', { label: 'Delete workspace…', run: () => deleteWorkspace(ws) },
    ]) },
    h('div', { class: 'row' }, icon('pin', 10), h('b', {}, nameOf(ws)), h('span', { class: 'sp' }), active > 0 && h('i', { class: 'dot running' }), (needs.length > 0 || ringing) && h('span', { class: 'badge' }, String(Math.max(needs.length, 1)))),
    S.descriptions[ws] && h('small', { class: 'desc' }, S.descriptions[ws]),
    h('small', { class: needs.length ? 'two' : '' }, needs[0]?.message || (counts ? `${where} · ${counts}` : where)))
}
function installUpdate() {
  const active = (S.state?.runs || []).filter(isActive).length
  if (!active) return window.argo.update.install()
  confirmBox('Install the update now?', `${active} run${active === 1 ? ' is' : 's are'} in progress. Installing quits Argo, which closes its terminals and interrupts work handed to them.`, 'Install and relaunch', () => window.argo.update.install())
}
// Shown at the bottom of the sidebar when a newer version exists: one click downloads and installs it.
function updatePill() {
  const u = S.update
  if (u.phase === 'available') return h('button', { class: 'btn primary', title: 'Downloads and installs the new version here, then reopens Argo', onclick: installUpdate }, icon('down', 12), `Update to ${u.version}`)
  if (u.phase === 'downloading') return h('div', { class: 'row' }, h('progress', { value: u.pct || 0, max: 100 }), h('span', { class: 'dim' }, `${u.pct || 0}%`))
  if (u.phase === 'installing') return h('span', { class: 'dim' }, 'Installing update…')
  if (u.phase === 'failed') return h('span', { class: 'warn', title: u.message }, u.message)
  return null
}
function renderSidebar() {
  $('sidebar').hidden = S.sidebarHidden
  paint($('sidetools'), S.sidebarHidden ? null : tools())
  paint($('workspaces'), workspaceList().map(wsTab), h('button', { class: 'ws new', title: 'Add another workspace. Use the + menu to open a folder as one.', onclick: newWorkspace }, icon('plus', 11), 'New workspace'))
  paint($('agents'), (S.state?.agents || []).map((a) => h('div', { class: 'agent' + (a.installed ? ' ok ' + agClass(a.id) : ''), title: a.note || (a.id === 'ollama' && a.installed ? a.models.map((m) => `${m.id} (${m.note})`).join('\n') : a.version || '') },
    h('i'), h('span', {}, a.label), h('span', {}, a.installed ? (a.id === 'ollama' ? plural(a.models.length, 'model') : 'ready') : a.note ? 'needs setup' : 'not installed'))))
  paint($('update'), updatePill())
}
function layoutMenu(e) {
  const ws = S.project, n = termsIn(ws).length, tpl = load('defaultLayout', null), saved = countOf(tpl)
  menu(e, [
    { label: 'Save this layout as default', disabled: !n, run: () => { save('defaultLayout', capture(S.layouts[ws])); alertBox(`Saved. New workspaces, and Argo the next time it opens, start with these ${plural(n, 'terminal')} arranged like this.`) } },
    saved > 0 && { label: `Open the default layout here (${plural(saved, 'terminal')})`, disabled: n > 0, run: () => applyTemplate(tpl, ws) },
    saved > 0 && '-', saved > 0 && { label: 'Clear the default layout', run: () => localStorage.removeItem('defaultLayout') },
  ])
}
// The worktree button: start a fresh worktree from the latest remote code with an agent in it, or put
// another agent into an existing one, pull what teammates pushed, or remove it.
function worktreeMenu(e) {
  const kinds = KINDS.filter(([id]) => usable(id)), ws = S.project
  menu(e, [
    { head: 'New worktree from latest' },
    ...kinds.map(([id, label]) => ({ label: `${label} in a new worktree`, run: () => newWorktree(id) })),
    S.worktrees.length > 0 && { head: 'Worktrees' },
    ...S.worktrees.map((w) => {
      const names = termsIn(ws).filter((t) => t.worktree === w.name).map((t) => t.name)
      return { label: `⑂ ${w.name}${w.behind > 0 ? `  (${w.behind} behind)` : ''}${names.length ? '  · ' + names.join(', ') : ''}`, sub: [
        { head: `${w.name} · ${w.branch}` },
        ...kinds.map(([id, label]) => ({ label: `Open ${label} here`, run: () => addTerm(id, ws, { tree: w }) })), '-',
        { label: w.behind > 0 ? `Pull latest (${plural(w.behind, 'new commit')})` : 'Pull latest', disabled: !w.upstream, run: () => pullWorktree(w) },
        { label: `Show in ${fileManager()}`, run: () => window.argo.open(w.path) }, '-',
        { label: w.dirty > 0 ? `Remove (discards ${plural(w.dirty, 'uncommitted change')})…` : 'Remove', run: () => w.dirty > 0
          ? confirmBox(`Remove the worktree ${w.name}?`, `Its ${plural(w.dirty, 'uncommitted change')} will be discarded and its terminals closed. Committed work stays on the branch ${w.branch} unless it is already on the remote.`, 'Remove', () => removeWorktree(w))
          : removeWorktree(w) },
      ] }
    }),
    '-', { label: 'Check for new pushes', run: () => loadWorktrees(true) },
  ])
}
function renderTop() {
  const ws = S.project, n = termsIn(ws).length, folder = folderOf(ws), behind = S.worktrees.some((w) => w.behind > 0), saved = countOf(load('defaultLayout', null))
  paint($('topbar'), S.sidebarHidden && h('div', { class: 'tools' }, tools()), h('span', { class: 'dim row' }, icon('folder', 13)), h('b', {}, nameOf(ws)), h('span', { class: 'dim', style: 'font-size:10.5px' }, plural(n, 'terminal')), h('span', { class: 'sp' }),
    h('button', { class: 'icon' + (behind ? ' hot' : ''), disabled: !folder, title: folder ? 'Give an agent its own worktree, started from the latest code on the remote' : 'Choose a git project to use worktrees', onclick: worktreeMenu }, icon('branch', 13), 'Worktree'),
    h('button', { class: 'icon', title: saved ? `Default layout: ${plural(saved, 'terminal')}` : 'Save how the terminals are arranged as the default', onclick: layoutMenu }, icon('layout', 13), 'Layout'),
    h('button', { class: 'icon', title: 'Open a terminal in this workspace', onclick: (e) => menu(e, termItems()) }, icon('plus', 13), 'Add member'),
    S.rightHidden && !S.error && h('button', { class: 'icon', title: 'Show panel (Alt+Shift+B)', onclick: () => commands.toggleFiles() }, icon('panel')))
}
function deleteRun(id) {
  const x = runById(id); if (!x) return
  const unmerged = hasRepo(x) && !x.applied && x.tasks.some((t) => t.changedFiles.length)
  confirmBox('Delete this run?', `"${x.goal.slice(0, 80)}" and its record, logs and worktrees will be removed.` + (isActive(x) ? ' It is still running and will be cancelled.' : '') + (unmerged ? ` Its work has not been merged; the branch ${x.branch} is kept so nothing is lost.` : ''),
    'Delete run', () => act(async () => { await api('DELETE', 'runs/' + id); delete S.owner[id]; save('owner', S.owner) }))
}
// The runs of this workspace as a tab row. Click one to watch its agents; right-click to delete it.
function renderStrip() {
  const rs = runsIn(S.project), r = run()
  if (!rs.length) return paint($('runstrip'))
  const toggle = (id) => (S.selectedRun === id ? hideRun() : showRun(id))
  paint($('runstrip'), h('div', { class: 'tabs' }, rs.map((x) => {
    const id = x.id, on = id === S.selectedRun, needs = attn(id).length
    return h('button', { class: 'runtab' + (on ? ' on' : ''), title: on ? "Click to hide this run's agents" : x.goal, onclick: () => toggle(id), oncontextmenu: (e) => menu(e, [
      { label: S.selectedRun === id ? 'Hide agents' : 'Show agents', run: () => toggle(id) },
      { label: 'Open all subtask panes', run: () => { for (const k of [...S.closedPanes]) if (k.startsWith(id + '/')) S.closedPanes.delete(k); for (const t of runById(id)?.tasks || []) S.openPanes.add(`${id}/${t.id}`); showRun(id); render(true) } },
      [...S.openPanes].some((k) => k.startsWith(id + '/')) && { label: 'Close all subtask panes', run: () => { for (const k of [...S.openPanes]) if (k.startsWith(id + '/')) S.openPanes.delete(k); render(true) } },
      '-', { label: 'Delete run…', run: () => deleteRun(id) },
    ]) }, h('i', { class: 'dot ' + x.status }), h('span', { class: 'goal' }, x.goal), needs > 0 && h('span', { class: 'badge' }, String(needs)))
  })), r && h('div', { class: 'meta' }, `${pretty(r.status)} · ${hasRepo(r) ? r.branch : 'no repo'}`,
    hasRepo(r) && ['done', 'needs_attention'].includes(r.status) && r.report && h('button', { class: 'btn', disabled: !!r.applied, onclick: () => act(() => api('POST', `runs/${S.selectedRun}/apply`)) }, r.applied ? 'Applied' : `Merge into ${r.baseBranch}`),
    isActive(r) && h('button', { class: 'btn', onclick: () => act(() => api('POST', `runs/${S.selectedRun}/cancel`)) }, 'Cancel run')))
}
const retry = (runId, taskId) => act(() => api('POST', `runs/${runId}/tasks/${taskId}/retry`, {}))
// Which agent and model own a subtask, with the user's override of the orchestrator's choice.
function assignItems(runId, taskId) {
  const t = runById(runId)?.tasks.find((x) => x.id === taskId)
  if (!t || !canOverride(t)) return []
  const a = eff(t), sp = agent(a.agent), set = (body) => act(() => api('PATCH', `runs/${runId}/tasks/${taskId}`, body)), mark = (on, s) => (on ? '✓ ' : '    ') + s
  return [
    { head: 'Agent' }, ...S.state.agents.filter((x) => x.installed).map((x) => ({ label: mark(a.agent === x.id, x.label), run: () => set({ agent: x.id }) })),
    sp?.models.length > 0 && { head: 'Model' }, ...(sp?.models || []).map((m) => ({ label: mark(a.model === m.id, `${m.id || 'cli default'} — ${m.note}`), run: () => set({ model: m.id }) })),
    sp?.reasoning && { head: 'Reasoning' }, ...(sp?.reasoning ? ['low', 'medium', 'high'].map((x) => ({ label: mark(a.reasoning === x, x), run: () => set({ reasoning: x }) })) : []),
    t.override && '-', t.override && { label: "Use the orchestrator's choice", run: () => set({ clear: true }) },
  ]
}
// The run's subtasks as a compact row: status, who is doing it, and on which model.
// Nothing opens by itself; click a chip to open or close that subtask's output pane.
function renderChips() {
  const r = run()
  if (!r || !r.tasks.length) return paint($('subtasks'))
  const rid = r.id
  paint($('subtasks'), r.tasks.map((t) => {
    const tid = t.id, key = `${rid}/${tid}`, open = S.openPanes.has(key), a = eff(t), needs = attn(rid, tid).length || t.status === 'failed', there = inTerminal(t)
    const who = there ? (t.terminal || 'waiting for a terminal') : `${agent(a.agent)?.label || '?'} · ${a.model || 'cli default'}`
    return h('button', { class: 'chipbtn' + (open ? ' open' : '') + (needs ? ' attn' : ''),
      title: there ? `Running in the terminal ${t.terminal || ''}` : needs ? 'Needs you. Click to open.' : open ? "Click to close this subtask's output" : "Click to see this subtask's output. Right-click to change its agent.",
      onclick: () => { const x = runById(rid)?.tasks.find((y) => y.id === tid); if (!x || inTerminal(x)) return; if (S.openPanes.has(key)) S.openPanes.delete(key); else { S.openPanes.add(key); S.closedPanes.delete(key) } render(true) },
      oncontextmenu: (e) => { const x = runById(rid)?.tasks.find((y) => y.id === tid), items = [x && ['failed', 'needs_attention', 'cancelled'].includes(x.status) && { label: 'Retry', run: () => retry(rid, tid) }, ...assignItems(rid, tid)].filter(Boolean); if (items.length) menu(e, items); else e.preventDefault() } },
      h('i', { class: 'dot ' + t.status }), h('em', { class: 'id' }, tid), h('span', { class: 'title' }, t.title), h('em', { class: agClass(a.agent) }, who), !there && icon(open ? 'chevU' : 'chevD', 9))
  }))
}
// Subtasks that are waiting for a terminal running their CLI, with the two ways to unblock them.
function renderBanners() {
  const r = run()
  paint($('banners'), (r ? r.tasks.filter((t) => t.delegate?.state === 'waiting') : []).map((t) => {
    const a = eff(t), label = agent(a.agent)?.label || 'a CLI', rid = r.id, tid = t.id, kind = a.agent
    return h('div', { class: 'banner' }, icon('wait', 12), h('b', {}, `${tid}: ${t.title}`), h('span', { class: 'dim' }, `is waiting for a free terminal running ${label}. Start it in a shell, or:`), h('span', { class: 'sp' }),
      h('button', { class: 'btn', onclick: () => addTerm(usable(kind) ? kind : 'shell', S.project) }, `Open ${label} terminal`), h('button', { class: 'btn', onclick: () => act(() => api('POST', `runs/${rid}/tasks/${tid}/background`)) }, 'Run in background'))
  }))
}

// ---------- the stage: terminals on top, then the run's own panes
const lineClass = (l) => l.startsWith('✓') ? 'ok' : l.startsWith('✗') || l.includes('error:') ? 'err' : l.startsWith('⚠') || l.startsWith('Follow-up') ? 'warn' : /^(⏺|\$ |✎)/.test(l) ? 'tool' : /^(──| {2}⎿|· )/.test(l) ? 'dimline' : ''
// where each log is scrolled to, so a repaint keeps it there (and a log left at the bottom keeps following)
const logPos = {}
function logView(key, lines) {
  const el = h('div', { class: 'log', 'data-log': key })
  el._key = `${S.selectedRun}/${key}`
  el.addEventListener('scroll', () => { if (el.isConnected) logPos[el._key] = { stick: el.scrollTop + el.clientHeight >= el.scrollHeight - 30, top: el.scrollTop } })
  fillLog(el, lines)
  return el
}
function fillLog(el, lines) {
  // the log is a tail, so once it is full only its first and last lines show that it moved on
  if (el._n === lines.length && el._last === lines[lines.length - 1] && el._first === lines[0]) return
  el.replaceChildren(...lines.map((l) => h('div', { class: lineClass(l) }, l || ' ')))
  el._n = lines.length; el._last = lines[lines.length - 1]; el._first = lines[0]
  if (el.isConnected) placeLog(el)
}
function placeLog(el) { const p = logPos[el._key]; el.scrollTop = !p || p.stick ? el.scrollHeight : p.top }
const logLines = (key) => (key === 'orchestrator' ? (S.logs.orchestrator || []).filter((l) => !l.startsWith('{')) : S.logs[key] || [])
// Panes laid out side by side or stacked, separated by hairlines you can drag to resize.
function split(horiz, cells, weights, onResize) {
  const box = h('div', { class: 'split ' + (horiz ? 'h' : 'v') })
  cells.forEach((c, i) => {
    if (i) {
      const g = h('div', { class: 'gutter' })
      g.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        const a = box.children[(i - 1) * 2], b = box.children[i * 2], start = horiz ? ev.clientX : ev.clientY
        const sa = horiz ? a.offsetWidth : a.offsetHeight, sb = horiz ? b.offsetWidth : b.offsetHeight, tot = weights[i - 1] + weights[i]
        if (sa + sb <= 0) return
        g.classList.add('drag')
        const move = (e) => {
          // move the boundary, keeping both neighbours above the minimum
          const floor = Math.min(60, (sa + sb) / 2), d = Math.max(floor - sa, Math.min(sb - floor, (horiz ? e.clientX : e.clientY) - start))
          weights[i - 1] = tot * (sa + d) / (sa + sb); weights[i] = tot - weights[i - 1]
          a.style.flex = weights[i - 1] + ' 1 0'; b.style.flex = weights[i] + ' 1 0'
          fitAll()
        }
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); g.classList.remove('drag'); onResize?.() }
        addEventListener('mousemove', move); addEventListener('mouseup', up)
      })
      box.append(g)
    }
    box.append(h('div', { class: 'cell', style: `flex:${weights[i]} 1 0` }, c))
  })
  return box
}
const fitAll = () => { for (const t of termsIn(S.project)) if (t.el.isConnected && t.el.clientWidth > 20 && t.el.clientHeight > 10) try { t.fit.fit() } catch {} }
addEventListener('resize', fitAll)
// Clicking a pane focuses it without repainting the stage, so the click itself is not lost.
function touch(id, pane) {
  const t = terms.get(id)
  if (!t || (S.focused === id && !S.ring.has(id) && !t.mail)) return
  S.focused = id; S.ring.delete(id); t.mail = null
  document.querySelectorAll('.pane.active[data-term]').forEach((p) => p.classList.remove('active'))
  pane.classList.add('active'); pane.classList.remove('ring'); pane.querySelector('.mail')?.remove()
  stageSig = stageSignature()
  renderSidebar(); updateTray()
}
function termPane(t) {
  const id = t.id, job = runsIn(t.ws).flatMap((x) => x.tasks).find((x) => x.terminal === t.name && x.delegate?.state === 'sent')
  const wt = t.worktree && S.worktrees.find((w) => w.name === t.worktree), behind = wt?.behind || 0
  const tool = (name, title, fn) => h('button', { class: 'icon', title, onclick: fn }, icon(name, 13))
  const pane = h('div', { class: 'pane' + (S.focused === id ? ' active' : '') + (S.ring.has(id) ? ' ring' : ''), 'data-term': id, onmousedown: () => touch(id, pane) },
    h('div', { class: 'tabbar' }, h('div', { class: 'tab' }, icon('term', 12), h('span', { class: 'name' }, t.name),
      t.worktree && h('span', { class: 'tag' + (behind ? ' hot' : ''), title: wt ? (behind ? `${behind} new commit(s) were pushed to ${wt.upstream || 'the remote'}. Pull latest from the worktree menu.` : `Up to date with ${wt.upstream || 'its base'}`) : t.cwd }, `⑂ ${t.worktree}${behind ? ` · ${behind} behind` : ''}`),
      t.exited && h('span', { class: 'tag' }, 'exited'),
      t.mail && h('span', { class: 'mail', title: t.mail }, icon('mail', 11), t.mail),
      job ? h('span', { class: 'job' }, h('i', { class: 'dot running' }), `${job.id}: ${job.title}`) : t.kind === 'shell' && t.cli && h('span', { class: 'tag' }, t.cli),
      h('button', { class: 'icon', title: 'Close this terminal (Ctrl+Shift+W)', onclick: () => closeTerm(id) }, icon('x', 10))),
    h('div', { class: 'tools' }, h('i', { class: 'dot' + (t.exited ? '' : ' ' + agClass(t.kind)), style: t.exited ? '' : 'background:currentColor', title: t.kind }), tool('term', 'New terminal beside this one', (e) => menu(e, termItems(id))),
      tool('splitR', 'Split right: open a terminal beside this one', () => addTerm('shell', t.ws, { beside: id, horiz: true })), tool('splitD', 'Split down: open a terminal below this one', () => addTerm('shell', t.ws, { beside: id, horiz: false })))),
    h('div', { class: 'body' }, t.el))
  return pane
}
const layoutView = (n) => n.leaf ? (terms.get(n.leaf) ? termPane(terms.get(n.leaf)) : h('div')) : split(n.h, n.kids.map(layoutView), n.w)
const closePane = (key) => { S.closedPanes.add(key); S.openPanes.delete(key); render(true) }
function taskPane(r, t) {
  const a = eff(t), needs = attn(r.id, t.id), rid = r.id, tid = t.id, key = `${rid}/${tid}`, lines = S.logs[tid] || [], sp = agent(a.agent), first = needs[0], aid = first?.id
  const body = lines.length ? logView(tid, lines) : h('div', { class: 'note' }, h('p', {}, t.description), t.dependsOn.length > 0 && h('p', { class: 'wait' }, 'waits for ' + t.dependsOn.join(', ')), h('p', { class: 'why' }, 'why: ' + (t.auto.why || '')))
  return h('div', { class: 'pane' + (needs.length ? ' ring' : '') + (['running', 'merging'].includes(t.status) ? ' active' : '') },
    h('div', { class: 'tabbar' }, h('div', { class: 'tab' }, icon('term', 12), h('span', { class: 'name' }, `${tid}: ${t.title}`), h('i', { class: 'dot ' + t.status })),
      h('div', { class: 'tools' }, h('button', { class: 'icon ' + agClass(a.agent), title: canOverride(t) ? `Click to override. Orchestrator's reason: ${t.auto.why || ''}` : t.auto.why || '', disabled: !canOverride(t), onclick: (e) => { const items = assignItems(rid, tid); if (items.length) menu(e, items) } },
        `${sp?.label || a.agent || '?'} · ${a.model || 'cli default'}${sp?.reasoning ? ' · ' + (a.reasoning || '') : ''}`),
      t.difficulty && h('span', { class: 'tag' + (t.difficulty === 'hard' ? ' strong' : ''), title: 'Difficulty, which decides the model' }, t.difficulty),
      h('span', { class: 'tag' + (t.override ? ' strong' : '') }, t.override ? 'override' : 'auto'),
      h('button', { class: 'icon', title: 'Close this pane', onclick: () => closePane(key) }, icon('x', 10)))),
    h('div', { class: 'body' }, body),
    first ? h('div', { class: 'attnbar' }, icon('bell', 13), h('span', { class: 'msg' }, first.message), h('span', { class: 'sp' }),
      first.kind === 'permission' && h('button', { class: 'btn primary', onclick: () => act(() => api('POST', `runs/${rid}/instruct`, { text: 'approve', source: 'windows' })) }, 'Approve'),
      h('button', { class: 'btn', onclick: () => retry(rid, tid) }, 'Retry'),
      h('button', { class: 'btn', onclick: () => act(() => api('POST', `attention/${aid}/resolve`)) }, 'Dismiss'))
      : t.status === 'failed' && h('div', { class: 'attnbar fail' }, h('span', { class: 'msg' }, t.error || 'failed'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: () => retry(rid, tid) }, 'Retry')))
}
function orchPane(r) {
  const key = r.id + '/orchestrator'
  return h('div', { class: 'pane' }, h('div', { class: 'tabbar' }, h('div', { class: 'tab' }, icon('term', 12), 'orchestrator'),
    h('div', { class: 'tools' }, r.planner ? `planned by ${agent(r.planner.agent)?.label || '?'} · ${r.planner.model || ''}` : '', h('button', { class: 'icon', title: 'Close this pane', onclick: () => closePane(key) }, icon('x', 10)))),
    h('div', { class: 'body' }, logView('orchestrator', logLines('orchestrator'))))
}
const stageW = {}
let stageSig = ''
const stagePanes = (r) => (r ? r.tasks.filter((t) => !inTerminal(t) && S.openPanes.has(`${r.id}/${t.id}`)) : [])
function stageSignature() {
  const ws = S.project, r = run()
  return JSON.stringify([ws, S.error, S.layouts[ws], S.focused, termsIn(ws).map((t) => [t.id, t.exited, t.mail, t.cli, S.ring.has(t.id), t.worktree && S.worktrees.find((w) => w.name === t.worktree)?.behind]), r?.id, r?.planner,
    stagePanes(r).map((t) => [t.id, t.title, t.status, t.error, t.difficulty, !!t.override, !!(S.logs[t.id] || []).length, attn(r.id, t.id).map((a) => a.id), eff(t)]), !!r && !S.closedPanes.has(r.id + '/orchestrator'),
    (S.state?.agents || []).map((a) => a.installed), runsIn(ws).flatMap((x) => x.tasks).filter((t) => t.delegate?.state === 'sent').map((t) => [t.id, t.terminal])])
}
function renderStage(force) {
  const ws = S.project, r = run(), layout = S.layouts[ws], hasT = !!layout && termsIn(ws).length > 0, stage = $('stage')
  const sig = stageSignature()
  if (!force && sig === stageSig) {
    // structure unchanged: only refresh the log text in place
    stage.querySelectorAll('[data-log]').forEach((el) => fillLog(el, logLines(el.getAttribute('data-log'))))
    return
  }
  stageSig = sig
  // keyboard focus returns to the terminal only if it was in the stage, never away from the prompt or a dialog
  const refocus = S.wantFocus || stage.contains(document.activeElement)
  S.wantFocus = false
  if (S.error) return stage.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'Orchestrator unavailable'), h('span', {}, S.error)))
  const panes = stagePanes(r), showOrch = !!r && !S.closedPanes.has(r.id + '/orchestrator'), cells = [], keys = []
  if (hasT) { cells.push(layoutView(layout)); keys.push('terminals') }
  for (const t of panes) { cells.push(taskPane(r, t)); keys.push('pane:' + t.id) }
  if (showOrch) { cells.push(orchPane(r)); keys.push('pane:orchestrator') }
  if (!cells.length) return stage.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'No terminals open'),
    h('span', {}, 'Open a terminal and start Claude, Devin or Codex in it. Tasks you type below are handed to those terminals, so you watch the agents work right there.'), h('button', { class: 'btn large', style: 'margin-top:6px', onclick: (e) => menu(e, termItems()) }, icon('plus', 12), 'Add member')))
  const w = (stageW[ws] ||= {}), weights = keys.map((k) => w[k] || 1)
  stage.replaceChildren(split(false, cells, weights, () => keys.forEach((k, i) => (w[k] = weights[i]))))
  stage.querySelectorAll('[data-log]').forEach(placeLog)
  requestAnimationFrame(() => { fitAll(); if (refocus && $('modal').hidden) terms.get(S.focused)?.term.focus() })
}

// ---------- the prompt bar
// The plan is approved here, next to where it was asked for.
function renderApprove() {
  const r = run()
  if (!r || r.status !== 'awaiting_approval') return paint($('approve'))
  paint($('approve'), icon('list', 16), h('div', {}, h('b', {}, `Plan ready: ${plural(r.tasks.length, 'subtask')}`), h('small', {}, 'Each subtask and its agent is listed above. Click one to open it; right-click to change its agent.')), h('span', { class: 'sp' }),
    h('button', { class: 'btn large', onclick: () => act(() => api('POST', `runs/${S.selectedRun}/cancel`)) }, 'Cancel'),
    h('button', { class: 'btn primary large', title: 'Ctrl+Enter', onclick: () => commands.approve() }, icon('play', 11), 'Approve & run'))
}
const isFollow = (r) => !S.forceNew && !!r && !['cancelled', 'failed', 'planning'].includes(r.status)
function renderComposer() {
  const r = run(), follow = isFollow(r), prompt = $('prompt')
  paint($('mode'), r ? [[false, 'Follow-up', 'reply', 'Adds to the run that is showing'], [true, 'New task', 'plus', 'Starts a separate run']].map(([v, label, ic, title]) => h('button', { class: S.forceNew === v ? 'on' : '', title, onclick: () => { S.forceNew = v; renderComposer() } }, icon(ic, 11), label)) : null)
  paint($('attachments'), S.attachments.map((p) => h('div', { class: 'attachment', title: p }, icon('file', 11), h('span', {}, base(p)), h('button', { title: 'Remove', onclick: () => { S.attachments = S.attachments.filter((x) => x !== p); renderComposer() } }, icon('x', 9)))))
  prompt.placeholder = follow ? 'Tell the agents what to do next…' : folderOf(S.project) ? `Describe one high-level task for ${base(S.project)}…` : 'Ask anything or describe a task. No project needed…'
  $('send').className = prompt.value.trim() || S.attachments.length ? 'ready' : ''
  $('attach').className = 'icon' + (S.attachments.length ? ' hot' : '')
  // the prompt grows with what is typed, up to four lines
  prompt.style.height = 'auto'
  prompt.style.height = Math.min(76, prompt.scrollHeight) + 'px'
}
const addAttachments = (paths) => { for (const p of paths) if (p && !S.attachments.includes(p)) S.attachments.push(p); renderComposer() }
async function send() {
  const prompt = $('prompt'), typed = prompt.value, files = S.attachments, r = run(), follow = isFollow(r), ws = S.project
  let text = typed.trim()
  if (!text && !files.length) return
  if (!text) text = 'Look at the attached files.'
  prompt.value = ''; S.attachments = []; renderComposer()
  try {
    if (files.length) text += await window.argo.attach(files)
    if (follow) await api('POST', `runs/${r.id}/instruct`, { text, source: 'windows' })
    else {
      // hand the subtasks other subtasks build on to the CLIs open in this workspace's terminals
      const hasCLI = termsIn(ws).some((t) => t.cli && !t.exited)
      const made = await api('POST', 'runs', { project: folderOf(ws), goal: text, terminals: hasCLI })
      S.owner[made.id] = ws; save('owner', S.owner)
      S.forceNew = false
      if (S.project === ws) { S.hidden.delete(made.id); S.selectedRun = made.id; S.logs = {}; S.rightTab = 'Record' }
    }
    await refresh()
  } catch (e) {
    // nothing was sent: give the words back
    if (!prompt.value) prompt.value = typed
    if (!S.attachments.length) S.attachments = files
    renderComposer()
    alertBox(clean(e))
  }
}

// ---------- right panel
// Renders agent-written text (Markdown-ish) as clean reading text: headings, lists, tables and code
// blocks are laid out properly instead of showing raw `**`, `#`, `|` and backtick characters.
function inline(s) {
  const span = h('span')
  for (const p of s.replace(/`/g, '').split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/)) {
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (p.startsWith('**') && p.length > 4) span.append(h('b', {}, p.slice(2, -2)))
    else if (link) span.append(/^https?:\/\//i.test(link[2]) ? h('a', { title: link[2], onclick: () => window.argo.openExternal(link[2]) }, link[1]) : link[1])
    else if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) span.append(h('i', {}, p.slice(1, -1)))
    else if (p) span.append(p)
  }
  return span
}
function prose(text) {
  const out = h('div', { class: 'prose' })
  let para = [], table = null, code = null
  const flush = () => { if (para.length) out.append(h('p', {}, inline(para.join(' ')))); para = []; table = null }
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const t = raw.trim()
    if (t.startsWith('```')) { if (code) { out.append(h('pre', {}, code.join('\n'))); code = null } else { flush(); code = [] } continue }
    if (code) { code.push(raw); continue }
    if (!t) { flush(); continue }
    if (t.startsWith('|') && t.endsWith('|') && t.length > 1) {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim())
      // the |---|---| line under the header carries no content
      if (cells.every((c) => c && /^[-: ]+$/.test(c))) continue
      if (!table) { flush(); table = h('table'); out.append(table) }
      table.append(h('tr', {}, cells.map((c) => h(table.children.length ? 'td' : 'th', {}, inline(c)))))
      continue
    }
    if (table) flush()
    if (/^[-*_ ]+$/.test(t) && t.replace(/ /g, '').length >= 3) { flush(); out.append(h('hr')); continue }
    const hd = t.match(/^(#{1,6})\s+(.*)$/), bl = t.match(/^[-*•]\s+(.*)$/), nm = t.match(/^(\d{1,3})[.)]\s+(.*)$/)
    if (hd) { flush(); out.append(h('h3', { class: 'l' + Math.min(3, hd[1].length) }, inline(hd[2].replace(/[# ]+$/, '')))) }
    else if (bl) { flush(); out.append(h('div', { class: 'li', style: `padding-left:${Math.min(3, Math.floor(raw.match(/^[ \t]*/)[0].length / 2)) * 12}px` }, h('i'), inline(bl[1]))) }
    else if (nm) { flush(); out.append(h('div', { class: 'li' }, h('em', {}, nm[1] + '.'), inline(nm[2]))) }
    else para.push(t)
  }
  if (code) out.append(h('pre', {}, code.join('\n')))
  flush()
  return out
}
const sect = (title, ...kids) => h('div', { class: 'sect' }, h('h5', {}, title), kids)
const muted = (s) => h('span', { class: 'dim', style: 'font-size:12px' }, s)
const bullets = (items, empty, tone = '') => (items.length ? items.map((i) => h('div', { class: 'bullet ' + tone }, h('i'), prose(i))) : muted(empty))
// File paths, one per line, with the folder dimmed so the file name stands out.
const fileList = (files) => h('div', { class: 'files' }, files.map((f) => { const name = base(f); return h('div', { title: f }, h('bdi', {}, h('span', { class: 'd' }, f.slice(0, f.length - name.length)), name)) }))
function recordView(r) {
  const authors = [...new Set(r.decisions.map((d) => d.by))]
  return [sect('Goal', prose(r.goal)), sect('Constraints', bullets(r.constraints, 'none stated')),
    sect('Follow-ups', r.followups.length ? r.followups.map((f) => h('div', {}, h('div', { class: 'who dim' }, cap(f.source.replace(/-/g, ' '))), prose(f.text))) : muted('None')),
    // one label per author, their notes as a list beneath it (headings in a notes file are not decisions)
    sect('Decisions', authors.length ? authors.map((by) => { const parts = by.split('/'); return h('div', {}, h('div', { class: 'who ' + agClass(parts[0]) }, [agent(parts[0])?.label || cap(parts[0]), ...parts.slice(1)].join(' · ')), bullets(r.decisions.filter((d) => d.by === by && !d.text.startsWith('#')).map((d) => d.text), 'None')) }) : muted('None yet')),
    sect('Who did what', r.tasks.map((t) => { const a = eff(t); return h('div', { class: 'task' }, h('div', { class: 'row' }, h('i', { class: 'dot ' + t.status }), h('b', {}, t.title)),
      h('div', { class: 'who ' + agClass(a.agent) }, `${agent(a.agent)?.label || '?'} · ${a.model || 'default model'}${t.difficulty ? ' · ' + t.difficulty : ''}${t.override ? ' · your choice' : ''}`), t.changedFiles.length > 0 && fileList(t.changedFiles)) }))]
}
function reportView(r) {
  const rep = r.report
  if (!rep) return r.error ? sect('Problem', prose(r.error)) : h('div', { class: 'sect' }, muted('The report appears once every subtask has finished and the review is in.'))
  return [rep.answer && sect('Answer', prose(rep.answer)), sect('Completed', bullets(rep.completed, 'Nothing', 'ok')), sect('Needs attention', bullets(rep.attention, 'Nothing', 'warn')),
    sect('Checks', rep.checks.length ? rep.checks.map((c) => h('div', { class: 'check' }, h('div', { class: 'row' }, icon(c.ok ? 'check' : 'cross', 12), h('span', {}, c.command), h('span', { class: 'tag' }, c.where)), !c.ok && h('pre', {}, c.output.slice(-600)))) : muted('No checks were configured or detected.')),
    sect('Reviewed by', prose(rep.reviewedBy || '-')), rep.changedFiles.length > 0 && sect(`Changed files (${rep.changedFiles.length})`, fileList(rep.changedFiles))]
}
// Usage: for the current workspace, which agent and model did what, how often each succeeded, and
// what it cost, grouped by agent with one row per model.
function usageView() {
  // runs saved before calls were recorded: one attempt per finished subtask, with the cost it kept
  const legacy = (r) => r.tasks.filter((t) => t.ranWith?.agent && ['done', 'failed', 'needs_attention'].includes(t.status)).map((t) => ({ at: t.startedAt || r.createdAt, ms: Math.max(0, (t.finishedAt || 0) - (t.startedAt || 0)), role: 'task', taskId: t.id, agent: t.ranWith.agent, model: t.ranWith.model || '', ok: t.status === 'done', costUsd: t.costUsd }))
  const all = runsIn(S.project).flatMap((r) => (r.usage || legacy(r)).map((c) => ({ c, r })))
  if (!all.length) return h('div', { class: 'usage' }, muted(`Nothing yet. Once a task runs in ${nameOf(S.project)}, each agent and model it used shows up here with its success rate and cost.`))
  const calls = all.map((e) => e.c)
  // total dollars across calls that reported a price, or null when none did
  const cost = (cs) => { const priced = cs.filter((c) => typeof c.costUsd === 'number'); return priced.length ? priced.reduce((s, c) => s + c.costUsd, 0) : null }
  const money = (d) => (d === 0 ? 'free' : d < 0.01 ? '<$0.01' : '$' + d.toFixed(2))
  const tokens = (cs) => { const n = cs.reduce((s, c) => s + (c.tokensIn || 0) + (c.tokensOut || 0), 0); return !n ? null : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M tokens' : n >= 1000 ? (n / 1000).toFixed(1) + 'k tokens' : n + ' tokens' }
  // dollars when the CLI reports them, otherwise tokens, otherwise a dash
  const spend = (cs) => { const c = cost(cs); return c !== null ? money(c) : tokens(cs) || '-' }
  const rate = (cs) => (cs.length ? Math.round((cs.filter((c) => c.ok).length / cs.length) * 100) + '%' : '-')
  const duration = (ms) => { const s = Math.floor(ms / 1000); return s < 60 ? s + 's' : `${Math.floor(s / 60)}m ${s % 60}s` }
  // ordered by what they cost, then by how much they ran
  const group = (cs, key) => { const m = new Map(); for (const c of cs) m.set(c[key], [...(m.get(c[key]) || []), c]); return [...m].sort((a, b) => (cost(b[1]) || 0) - (cost(a[1]) || 0) || b[1].length - a[1].length) }
  const roleName = (role, n) => (role === 'plan' ? plural(n, 'plan') : role === 'review' ? plural(n, 'review') : role === 'merge' || role === 'sync' ? plural(n, 'merge fix', 'merge fixes') : plural(n, 'subtask'))
  const what = ({ c, r }) => { const task = r.tasks.find((t) => t.id === c.taskId)?.title; return c.role === 'plan' ? `Planned: ${r.goal}` : c.role === 'review' ? `Reviewed: ${r.goal}` : c.role === 'merge' ? `Resolved a merge conflict${task ? ' in ' + task : ''}` : c.role === 'sync' ? `Merged a teammate's push into: ${r.goal}` : task || r.goal }
  const stat = (v, label) => h('div', {}, h('b', {}, v), h('small', {}, label))
  return h('div', { class: 'usage' },
    h('div', { class: 'stats' }, stat(cost(calls) !== null ? money(cost(calls)) : '-', 'spent'), stat(String(calls.length), calls.length === 1 ? 'agent call' : 'agent calls'), stat(rate(calls), 'succeeded')),
    group(calls, 'agent').map(([id, cs]) => h('div', {}, h('div', { class: 'agenthead' }, h('span', { class: agClass(id) }, agent(id)?.label || cap(id)), h('span', {}, spend(cs))),
      group(cs, 'model').map(([model, ms]) => {
        const roles = [...group(ms, 'role')].sort((a, b) => b[1].length - a[1].length).map(([role, x]) => roleName(role, x.length)).join(', '), tk = tokens(ms)
        return h('div', { class: 'model' }, h('div', { class: 'top' }, h('span', {}, model || (id === 'codex' ? 'configured model' : 'default model')), h('span', {}, spend(ms))),
          // success bar: the filled part is the share of calls that succeeded
          h('div', { class: 'bar ' + agClass(id) }, h('i', { style: `width:${(ms.filter((c) => c.ok).length / Math.max(1, ms.length)) * 100}%` })),
          h('small', {}, `${rate(ms)} of ${ms.length} succeeded · ${roles}${tk ? ' · ' + tk : ''}`))
      }))),
    h('div', {}, h('h5', {}, 'Who did what'), [...all].sort((a, b) => b.c.at - a.c.at).slice(0, 20).map((e) => { const c = e.c; return h('div', { class: 'call' }, icon(c.ok ? 'check' : 'cross', 11),
      h('div', {}, h('div', { class: 'what' }, what(e)), h('div', { class: 'who ' + agClass(c.agent) }, `${agent(c.agent)?.label || c.agent} · ${c.model || 'default model'}${c.terminal ? ' · in a terminal' : ''}${c.ms > 0 ? ' · ' + duration(c.ms) : ''}`)),
      h('span', { class: 'cost' }, typeof c.costUsd === 'number' ? money(c.costUsd) : tokens([c]) || '')) })),
    h('small', {}, 'Costs are what each CLI reports. Codex and Devin report none, so their tokens are shown instead; local Ollama models are free. Argo uses this record to route later tasks in this workspace.'))
}
// The file tree, as in the Mac app: the project folder (or home), folders first, expand in place.
async function fileRows(dir, depth, out) {
  const list = (S.dirs[dir] ||= await window.argo.listDir(dir)), q = S.searching ? S.filter.trim().toLowerCase() : ''
  for (const e of list) {
    const hit = !q || e.name.toLowerCase().includes(q), open = S.expanded.has(e.path)
    if (!hit && !(e.dir && open)) continue
    out.push(h('div', { class: 'file' + (S.selectedFile === e.path ? ' sel' : ''), style: `padding-left:${12 + depth * 14}px`, title: e.path,
      onclick: () => { S.selectedFile = e.path; if (e.dir) S.expanded.has(e.path) ? S.expanded.delete(e.path) : S.expanded.add(e.path); renderRight() },
      ondblclick: () => !e.dir && window.argo.open(e.path),
      oncontextmenu: (ev) => menu(ev, [{ label: `Show in ${fileManager()}`, run: () => window.argo.reveal(e.path) }, { label: 'Copy path', run: () => window.argo.copy(e.path) }, !e.dir && { label: 'Attach to the next message', run: () => addAttachments([e.path]) }]) },
      h('span', { class: 'tw' }, e.dir && icon(open ? 'chevD' : 'chevR', 9)), icon(e.dir ? 'folder' : 'file', 12), h('span', {}, e.name)))
    if (e.dir && open && depth < 12) await fileRows(e.path, depth + 1, out)
  }
}
let rightToken = 0
// Files and Usage always; Record and Report when a run is showing.
async function renderRight() {
  const r = run(), tabs = r ? ['Files', 'Record', 'Report', 'Usage'] : ['Files', 'Usage'], tab = tabs.includes(S.rightTab) ? S.rightTab : 'Files', token = ++rightToken
  $('right').hidden = S.rightHidden || !!S.error
  paint($('rtabs'), tabs.map((t) => h('button', { class: 'tabbtn' + (t === tab ? ' on' : ''), onclick: () => { S.rightTab = t; renderRight() } }, t)), h('span', { class: 'sp' }),
    h('button', { class: 'icon', title: 'Hide panel (Alt+Shift+B)', onclick: () => commands.toggleFiles() }, icon('panel')))
  $('filter').hidden = !(tab === 'Files' && S.searching)
  if (tab !== 'Files') { paint($('rhead')); return paint($('rbody'), tab === 'Usage' ? usageView() : tab === 'Record' ? recordView(r) : reportView(r)) }
  const root = folderOf(S.project) || S.info.home, rows = []
  if (root) await fileRows(root, 0, rows)
  if (token !== rightToken) return
  // the file tools sit with the folder they act on, not in the tab row
  paint($('rhead'), h('div', { class: 'path' }, icon('folder', 12), h('span', { class: 'p', title: root }, h('bdi', {}, tilde(root))), h('span', { class: 'sp' }),
    h('button', { class: 'icon' + (S.searching ? ' lit' : ''), title: 'Filter by name', onclick: () => { S.searching = !S.searching; if (!S.searching) { S.filter = ''; $('filter').value = '' } renderRight().then(() => S.searching && $('filter').focus()) } }, icon('search', 12)),
    h('button', { class: 'icon', title: 'Reload', onclick: () => { S.dirs = {}; renderRight() } }, icon('reload', 12)),
    h('button', { class: 'icon', title: `Show in ${fileManager()}`, onclick: () => window.argo.open(folderOf(S.project) || S.info.home) }, icon('open', 12))))
  paint($('rbody'), rows)
}

// ---------- settings and phone
const seg = (options, value, on, large) => {
  const box = h('div', { class: 'seg' + (large ? ' large' : '') })
  const draw = () => box.replaceChildren(...options.map(([v, label, ic]) => h('button', { class: v === value ? 'on' : '', onclick: () => { value = v; draw(); on(v) } }, ic && icon(ic, 12), label)))
  draw()
  return box
}
function openSettings() {
  if (!S.state) return
  const s = structuredClone(S.state.settings), inst = S.state.agents.filter((a) => a.installed)
  const sel = (value, opts, on) => { const e = h('select', { onchange: () => on(e.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))); return e }
  const checks = h('textarea', { rows: 3, placeholder: 'one command per line; empty = detect from the project', spellcheck: 'false' })
  checks.value = s.checks.join('\n')
  const par = h('input', { type: 'number', min: 1, max: 8, value: s.maxParallel, style: 'min-width:70px;width:70px' })
  const auto = h('input', { type: 'checkbox', checked: s.autoApprove })
  const updates = h('div', { class: 'line' })
  const drawUpdates = () => {
    const u = S.update, busy = ['checking', 'downloading', 'installing'].includes(u.phase)
    const status = { idle: ['Checks the latest release on GitHub.'], checking: ['Checking…'], upToDate: ["You're up to date."], available: [`Version ${u.version} is available. It downloads and installs here, then Argo reopens.`, 'hot'],
      downloading: [`Downloading… ${u.pct || 0}%`], installing: ['Installing. Argo will reopen in a moment.'], failed: [u.message, 'warn'] }[u.phase] || ['']
    updates.replaceChildren(...[h('div', {}, h('div', {}, 'Argo ' + S.info.version), h('small', { class: status[1] || '' }, status[0])), h('span', { class: 'sp' }),
      u.phase === 'available' && h('button', { class: 'btn primary', onclick: installUpdate }, 'Install update'), u.phase === 'downloading' && h('progress', { value: u.pct || 0, max: 100, style: 'max-width:90px' }),
      h('button', { class: 'btn', disabled: busy, onclick: () => window.argo.update.check() }, 'Check for Updates')].filter(real))
  }
  drawUpdates()
  S.onUpdate = drawUpdates
  modal(h('div', { class: 'dialog wide' }, h('h3', {}, 'Settings'),
    h('h4', {}, 'Appearance'),
    h('div', { class: 'group' }, h('div', { class: 'line' }, 'Theme', seg([['system', 'System', 'half'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']], localStorage.getItem('theme') || 'dark', (v) => { localStorage.setItem('theme', v); applyTheme() }, true))),
    h('h4', {}, 'Updates'), h('div', { class: 'group' }, updates),
    h('h4', {}, 'Model controls'),
    h('div', { class: 'group' },
      h('label', {}, 'Default CLI', sel(s.defaultAgent, [['auto', 'Auto: the orchestrator picks per subtask'], ...inst.map((a) => [a.id, a.label])], (v) => (s.defaultAgent = v))),
      inst.map((a) => h('label', {}, a.label + ' model', sel(s.models[a.id] ?? '__default', [['__default', 'Orchestrator default'], ...a.models.map((m) => [m.id, m.id ? `${m.id} — ${m.note}` : 'cli default'])], (v) => { if (v === '__default') delete s.models[a.id]; else s.models[a.id] = v }))),
      h('label', {}, 'Reasoning level', sel(s.reasoning, [['low', 'low'], ['medium', 'medium'], ['high', 'high']], (v) => (s.reasoning = v))),
      h('label', {}, 'Parallel agents', par), h('label', {}, 'Run plans without waiting for my approval', auto), h('label', { class: 'col' }, 'Checks', checks)),
    h('div', { class: 'foot' }, h('small', {}, 'Reasoning applies to Claude Code and Codex; Devin encodes it in the model name.'), h('button', { class: 'btn large', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary large', onclick: () => {
      closeModal()
      // the server replaces the pinned models with what it is sent, so a model the user un-pinned is simply left out
      const models = Object.fromEntries(inst.filter((a) => s.models[a.id] !== undefined).map((a) => [a.id, s.models[a.id]]))
      act(() => api('PUT', 'settings', { defaultAgent: s.defaultAgent, models, reasoning: s.reasoning, maxParallel: Math.max(1, Math.min(8, Number(par.value) || 3)), autoApprove: auto.checked, checks: checks.value.split('\n').map((c) => c.trim()).filter(Boolean) }))
    } }, 'Save'))), () => (S.onUpdate = null))
}
function openPhone() {
  if (!S.state) return
  const url = h('input', { type: 'text', class: 'full', placeholder: 'Public HTTPS address of the web app (from web/tunnel.sh)', value: S.state.settings.publicUrl || '' })
  const qr = h('div'), code = h('div')
  const drawQR = async () => { const v = url.value.trim(), data = v ? await window.argo.qr(v) : ''; qr.replaceChildren(...(data ? [h('img', { class: 'qr', src: data, alt: 'QR code for ' + v })] : [])) }
  const loadPair = async () => {
    try { const p = await api('GET', 'pair'); code.replaceChildren(h('div', { class: 'code' }, p.code), h('small', {}, `Pairing code · single use · expires ${new Date(p.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)) }
    catch (e) { code.replaceChildren(h('small', { class: 'warn' }, clean(e))) }
  }
  const done = h('button', { class: 'btn primary large', onclick: closeModal }, 'Done')
  modal(h('div', { class: 'dialog narrow' }, h('h3', {}, 'Control from your phone'),
    h('p', { class: 'dim' }, 'Open the Argo web app on your phone, sign in, and enter this one-time code. Until a phone account is paired it cannot see or control anything.'),
    qr, h('div', { class: 'line', style: 'width:100%' }, url, h('button', { class: 'btn', onclick: () => act(async () => { await api('PUT', 'settings', { publicUrl: url.value.trim() }); drawQR() }) }, 'Save')),
    code, h('div', { class: 'foot' }, h('button', { class: 'btn large', onclick: loadPair }, 'New code'), h('span', { class: 'sp' }), done)))
  drawQR(); loadPair()
}
function applyTheme() {
  const t = localStorage.getItem('theme') || 'dark', light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.classList.toggle('light', light)
  for (const x of terms.values()) x.term.options.theme = termTheme()
}
// follow the system when it switches while the theme is set to System
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme)

// ---------- commands and their keys
// What the Mac app has in its menu bar. Shortcuts carry Shift or Alt so the plain Ctrl keys stay with the terminals.
const commands = {
  newWorkspace, openFolder, settings: openSettings, phone: openPhone, attention: jumpToAttention, jumpUnread: jumpToUnread,
  closePane: () => { const t = focusedTerm(); if (t) closeTerm(t.id) },
  closeWorkspace: () => deleteWorkspace(S.project),
  newTerminal: () => addTerm('shell', S.project),
  newMember: (kind) => { if (usable(kind)) addTerm(kind, S.project); else alertBox(`${agent(kind)?.label || cap(kind)} is not installed${agent(kind)?.note ? ': ' + agent(kind).note : '.'}`) },
  splitRight: () => splitFocused(true), splitDown: () => splitFocused(false),
  nextPane: () => movePane(1), prevPane: () => movePane(-1),
  nextWorkspace: () => step(1), prevWorkspace: () => step(-1),
  workspace: (n) => { const ws = workspaceList()[n - 1]; if (ws !== undefined) select(ws) },
  selectWorkspace: (ws) => { if (workspaceList().includes(ws)) select(ws) },
  focusTerm,
  toggleSidebar: () => { S.sidebarHidden = !S.sidebarHidden; render(); requestAnimationFrame(fitAll) },
  toggleFiles: () => { S.rightHidden = !S.rightHidden; render(); requestAnimationFrame(fitAll) },
  approve: () => { const r = run(); if (r?.status === 'awaiting_approval') act(() => api('POST', `runs/${r.id}/approve`)) },
  quit: () => window.argo.quit(),
}
const KEYS = {
  'C-S-KeyN': ['newWorkspace'], 'C-S-KeyO': ['openFolder'], 'C-S-KeyW': ['closePane'], 'A-S-KeyW': ['closeWorkspace'], 'C-S-KeyT': ['newTerminal'],
  ...Object.fromEntries(KINDS.map(([id], i) => [`A-S-Digit${i + 1}`, ['newMember', id]])),
  'C-S-KeyD': ['splitRight'], 'A-S-KeyD': ['splitDown'], 'A-S-BracketRight': ['nextPane'], 'A-S-BracketLeft': ['prevPane'], 'C-S-KeyU': ['jumpUnread'],
  'C-S-BracketRight': ['nextWorkspace'], 'C-S-BracketLeft': ['prevWorkspace'], 'C-Tab': ['nextWorkspace'], 'C-S-Tab': ['prevWorkspace'],
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`A-Digit${n}`, ['workspace', n]])),
  'C-S-KeyB': ['toggleSidebar'], 'A-S-KeyB': ['toggleFiles'], 'C-Comma': ['settings'], 'C-S-KeyQ': ['quit'],
}
function commandMenu(e) {
  const it = (label, hint, name, arg) => ({ label, hint, run: () => commands[name](arg) })
  menu(e, [
    { head: 'File' }, it('New Workspace', 'Ctrl+Shift+N', 'newWorkspace'), it('Open Folder…', 'Ctrl+Shift+O', 'openFolder'), it('Close Pane', 'Ctrl+Shift+W', 'closePane'), it('Close Workspace…', 'Alt+Shift+W', 'closeWorkspace'),
    { head: 'Team' }, it('New Terminal', 'Ctrl+Shift+T', 'newTerminal'), ...KINDS.map(([id, label], i) => ({ ...it(`New ${label} Member`, `Alt+Shift+${i + 1}`, 'newMember', id), disabled: !usable(id) })),
    it('Split Right', 'Ctrl+Shift+D', 'splitRight'), it('Split Down', 'Alt+Shift+D', 'splitDown'), it('Next Pane', 'Alt+Shift+]', 'nextPane'), it('Previous Pane', 'Alt+Shift+[', 'prevPane'), it('Jump to Unread', 'Ctrl+Shift+U', 'jumpUnread'),
    { head: 'Workspace' }, it('Next Workspace', 'Ctrl+Tab', 'nextWorkspace'), it('Previous Workspace', 'Ctrl+Shift+Tab', 'prevWorkspace'), { label: 'Workspace 1 to 9', hint: 'Alt+1 … Alt+9', disabled: true },
    it('Toggle Sidebar', 'Ctrl+Shift+B', 'toggleSidebar'), it('Toggle Files Panel', 'Alt+Shift+B', 'toggleFiles'),
    '-', it('Settings…', 'Ctrl+,', 'settings'), it('Control from your phone…', '', 'phone'), it('Quit Argo', 'Ctrl+Shift+Q', 'quit'),
  ])
}
// Seen before the terminal gets the key. AltGr arrives as Ctrl+Alt and matches nothing here, so typing is never taken.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.menu')) { closeMenus(); e.preventDefault(); e.stopPropagation() }
    else if (!$('modal').hidden) { closeModal(); e.preventDefault(); e.stopPropagation() }
    return
  }
  if (e.isComposing || e.metaKey) return
  const combo = (e.ctrlKey ? 'C-' : '') + (e.altKey ? 'A-' : '') + (e.shiftKey ? 'S-' : '') + e.code
  // the plan is approved from anywhere while it is waiting
  const hit = combo === 'C-Enter' && run()?.status === 'awaiting_approval' ? ['approve'] : KEYS[combo]
  if (!hit || (!$('modal').hidden && hit[0] !== 'quit')) return
  e.preventDefault(); e.stopPropagation()
  closeMenus()
  commands[hit[0]](hit[1])
}, true)
window.argo.onCommand((name, arg) => commands[name]?.(arg))
window.argo.update.onState((u) => { S.update = u; renderSidebar(); S.onUpdate?.() })

// ---------- start
$('settingsBtn').append(icon('gear', 12), 'Settings'); $('phoneBtn').append(icon('phone', 12), 'Phone'); $('attach').append(icon('clip', 15)); $('send').append(icon('up', 13))
$('settingsBtn').onclick = openSettings
$('phoneBtn').onclick = openPhone
$('send').onclick = send
$('attach').onclick = async () => addAttachments(await window.argo.pickFiles())
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } })
$('prompt').addEventListener('input', renderComposer)
$('filter').addEventListener('input', () => { S.filter = $('filter').value; renderRight() })
$('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeModal() })
// Files dropped on the prompt bar are attached; dropped on a terminal their path is typed. Anywhere else nothing
// happens (left alone, the window would navigate to the dropped file).
addEventListener('dragover', (e) => { e.preventDefault(); $('composer').classList.toggle('drop', $('composer').contains(e.target)) })
addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('composer').classList.remove('drop') })
addEventListener('drop', (e) => {
  e.preventDefault()
  $('composer').classList.remove('drop')
  const paths = [...(e.dataTransfer?.files || [])].map((f) => window.argo.pathOf(f)).filter(Boolean)
  if (!paths.length) return
  const pane = e.target.closest?.('[data-term]'), t = pane && terms.get(pane.getAttribute('data-term'))
  if ($('composer').contains(e.target)) addAttachments(paths)
  else if (t && !t.exited) { t.term.paste(paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')); t.term.focus() }
})
;(async () => {
  applyTheme()
  render()
  S.info = await window.argo.info()
  S.update = await window.argo.update.state()
  S.error = (await window.argo.ensure().catch(clean)) || null
  await refresh()
  // what the headless UI check asks to see
  if (S.info.demo.tab) { S.rightTab = S.info.demo.tab; render() }
  if (S.info.demo.sheet === 'settings') openSettings(); else if (S.info.demo.sheet === 'phone' || S.info.demo.sheet === 'mobile') openPhone()
  for (;;) { await new Promise((r) => setTimeout(r, 1200)); await refresh() }
})()
