// Argo for Windows: the window. Talks to the local orchestrator through the preload bridge.
const $ = (id) => document.getElementById(id)
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k)
  return e
}
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v))
const pretty = (s) => String(s || '').replace(/_/g, ' ')
const KINDS = [['claude', 'Claude'], ['devin', 'Devin'], ['codex', 'Codex'], ['ollama', 'Ollama'], ['shell', 'Shell']]
const AGENT_KINDS = ['claude', 'devin', 'codex', 'ollama']

const S = {
  info: { home: '', platform: 'win32', version: '', msg: 'argo-msg' },
  state: null, error: null, logs: {},
  project: load('project', ''), workspaces: load('workspaces', []), names: load('names', {}), descriptions: load('descriptions', {}),
  owner: load('owner', {}), selectedRun: null, hidden: new Set(), openPanes: new Set(), closedPanes: new Set(),
  rightTab: 'Files', forceNew: false, expanded: new Set(), selectedFile: null, dirs: {},
  layouts: {}, opened: new Set(), focused: null,
}
const terms = new Map()
const folderOf = (ws) => (!ws || ws.startsWith('ws:') ? '' : ws)
const base = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p
const nameOf = (ws) => S.names[ws] || (folderOf(ws) ? base(ws) : 'No project')
const wsOfRun = (r) => { const o = S.owner[r.id]; return o !== undefined && (S.workspaces.includes(o) || o === S.project) ? o : /[\\/]\.argo[\\/]workspaces[\\/]/.test(r.project) ? '' : r.project }
const runsIn = (ws) => (S.state?.runs || []).filter((r) => wsOfRun(r) === ws)
const run = () => (S.state?.runs || []).find((r) => r.id === S.selectedRun)
const agent = (id) => (S.state?.agents || []).find((a) => a.id === id)
const eff = (t) => t.ranWith || { agent: t.override?.agent || t.auto.agent, model: t.override?.model ?? t.auto.model, reasoning: t.override?.reasoning || t.auto.reasoning }
const inTerminal = (t) => !!t.delegate || (!!t.terminal && t.status === 'done')
const attn = (runId, taskId) => (S.state?.attention || []).filter((a) => a.runId === runId && a.kind !== 'completed' && (!taskId || a.taskId === taskId))
const termsIn = (ws) => [...terms.values()].filter((t) => t.ws === ws)
const workspaceList = () => { const out = []; for (const w of [...S.workspaces, S.project, ...(S.state?.runs || []).map(wsOfRun), ...[...terms.values()].map((t) => t.ws)]) if (!out.includes(w)) out.push(w); return out }
const api = (m, route, body) => window.argo.api(m, route, body)
const act = async (fn) => { try { await fn(); await refresh() } catch (e) { alertBox(e.message || String(e)) } }

// ---------- dialogs and menus
function alertBox(text) { modal(h('div', { class: 'dialog' }, h('p', {}, text), h('div', { class: 'foot' }, h('button', { class: 'btn primary large', onclick: closeModal }, 'OK')))) }
function confirmBox(title, text, label, fn) {
  modal(h('div', { class: 'dialog' }, h('h3', {}, title), h('p', { class: 'dim' }, text),
    h('div', { class: 'foot' }, h('button', { class: 'btn large', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary large', onclick: () => { closeModal(); fn() } }, label))))
}
function promptBox(title, value, fn) {
  const input = h('input', { type: 'text', value })
  const ok = () => { closeModal(); fn(input.value) }
  input.addEventListener('keydown', (e) => e.key === 'Enter' && ok())
  modal(h('div', { class: 'dialog' }, h('h3', {}, title), input, h('div', { class: 'foot' }, h('button', { class: 'btn large', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary large', onclick: ok }, 'Save'))))
  input.focus(); input.select()
}
function modal(node) { $('modal').replaceChildren(node); $('modal').hidden = false }
function closeModal() { $('modal').hidden = true; $('modal').replaceChildren() }
function menu(ev, items) {
  ev.preventDefault(); ev.stopPropagation()
  document.querySelectorAll('.menu').forEach((m) => m.remove())
  const m = h('div', { class: 'menu' }, items.filter(Boolean).map((it) => it === '-' ? h('hr') : h('button', { disabled: it.disabled, onclick: () => { m.remove(); it.run() } }, it.label)))
  document.body.append(m)
  m.style.left = Math.min(ev.clientX, innerWidth - m.offsetWidth - 8) + 'px'
  m.style.top = Math.min(ev.clientY, innerHeight - m.offsetHeight - 8) + 'px'
}
addEventListener('click', () => document.querySelectorAll('.menu').forEach((m) => m.remove()))

// ---------- workspaces
function select(ws) {
  S.project = ws; save('project', ws)
  if (ws && !S.workspaces.includes(ws)) { S.workspaces.push(ws); save('workspaces', S.workspaces) }
  S.selectedRun = runsIn(ws).find((r) => !S.hidden.has(r.id))?.id || null
  if (!S.selectedRun && S.rightTab !== 'Files') S.rightTab = 'Files'
  S.dirs = {}; S.expanded.clear()
  openFirst(); render(true)
}
function newWorkspace() {
  const key = 'ws:' + Math.random().toString(16).slice(2, 10)
  S.names[key] = 'Workspace ' + (S.workspaces.filter((w) => w.startsWith('ws:')).length + 1); save('names', S.names)
  select(key)
}
async function openFolder() { const p = await window.argo.chooseFolder(); if (p) select(p) }
function deleteWorkspace(ws) {
  const rs = runsIn(ws), ts = termsIn(ws)
  confirmBox(`Delete the workspace "${nameOf(ws)}"?`, `This closes its ${ts.length} terminal(s) and deletes its ${rs.length} run(s) with their records.` + (folderOf(ws) ? ' The folder and its files are not touched; branches with unmerged work are kept.' : ''), 'Delete workspace', () => act(async () => {
    for (const t of ts) closeTerm(t.id)
    for (const r of rs) await api('DELETE', 'runs/' + r.id)
    S.workspaces = S.workspaces.filter((w) => w !== ws); save('workspaces', S.workspaces)
    delete S.names[ws]; delete S.descriptions[ws]; save('names', S.names); save('descriptions', S.descriptions)
    if (S.project === ws) select(S.workspaces[0] || '')
  }))
}

// ---------- terminals and their split layout
const insert = (n, target, id, horiz) => {
  if (n.leaf) return n.leaf === target ? { h: horiz, kids: [n, { leaf: id }], w: [1, 1] } : n
  const i = n.kids.findIndex((k) => k.leaf === target)
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
function addTerm(kind, ws, beside, horiz = true, place = true) {
  const label = KINDS.find((k) => k[0] === kind)?.[1] || kind
  const n = Math.max(0, ...termsIn(ws).filter((t) => t.kind === kind).map((t) => Number(t.name.split(' ').pop()) || 0)) + 1
  const id = 't' + Math.random().toString(36).slice(2, 9)
  const el = h('div', { class: 'term' })
  const term = new Terminal({ fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace', fontSize: 12.5, cursorBlink: true, allowProposedApi: true, theme: termTheme() })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit); term.open(el)
  const t = { id, name: `${label} ${n}`, kind, ws, cwd: folderOf(ws) || S.info.home, term, fit, el, exited: false, mail: null }
  terms.set(id, t)
  term.onData((d) => window.argo.pty.write(id, d))
  term.onResize(({ cols, rows }) => window.argo.pty.resize(id, cols, rows))
  if (place) {
    const mine = termsIn(ws).filter((x) => x.id !== id).map((x) => x.id)
    const target = beside || (mine.includes(S.focused) ? S.focused : mine[mine.length - 1])
    S.layouts[ws] = target && S.layouts[ws] ? insert(S.layouts[ws], target, id, horiz) : { leaf: id }
  }
  S.focused = id
  window.argo.pty.create({ id, name: t.name, kind, cwd: t.cwd, workspace: ws, cols: 100, rows: 30 })
  if (place) render(true)
  return id
}
function closeTerm(id) {
  const t = terms.get(id); if (!t) return
  window.argo.pty.kill(id); t.term.dispose(); terms.delete(id)
  S.layouts[t.ws] = S.layouts[t.ws] ? remove(S.layouts[t.ws], id) : null
  if (S.focused === id) S.focused = termsIn(t.ws).pop()?.id || null
  render(true)
}
const termTheme = () => document.documentElement.classList.contains('light')
  ? { background: '#f7f7f7', foreground: '#1c1c1e', cursor: '#000', selectionBackground: '#007aff44' }
  : { background: '#1e1e1e', foreground: '#ebebeb', cursor: '#fff', selectionBackground: '#007aff66' }
window.argo.pty.onData((id, data) => terms.get(id)?.term.write(data))
window.argo.pty.onExit((id) => { const t = terms.get(id); if (t) { t.exited = true; render(true) } })
window.argo.onMail((id, from, text) => { const t = terms.get(id); if (t) { t.mail = `${from}: ${text}`; render(true) } })

// default layout: the saved arrangement, or one shell
const capture = (n) => n.leaf ? (terms.get(n.leaf) ? { kind: terms.get(n.leaf).kind } : null) : { h: n.h, items: n.kids.map(capture).filter(Boolean), w: n.w }
function applyTemplate(tpl, ws) {
  const build = (t) => {
    if (t.kind) { const ok = t.kind === 'shell' || agent(t.kind)?.installed; return { leaf: addTerm(ok ? t.kind : 'shell', ws, null, true, false) } }
    const kids = (t.items || []).map(build).filter(Boolean)
    return !kids.length ? null : kids.length === 1 ? kids[0] : { h: t.h !== false, kids, w: kids.map((_, i) => t.w?.[i] || 1) }
  }
  const tree = build(tpl)
  if (tree) S.layouts[ws] = tree
  S.focused = termsIn(ws)[0]?.id || null
  render(true)
}
function openFirst() {
  const ws = S.project
  if (!S.state || S.opened.has(ws) || termsIn(ws).length) return
  S.opened.add(ws)
  const tpl = load('defaultLayout', null)
  if (tpl) applyTemplate(tpl, ws); else addTerm('shell', ws)
}

// ---------- polling and dispatch
async function refresh() {
  try {
    S.state = await api('GET', 'state'); S.error = null
    if (!S.project && !S.workspaces.length && S.state.projects[0] && localStorage.getItem('project') === null) select(S.state.projects[0])
    const mine = runsIn(S.project)
    if (!mine.some((r) => r.id === S.selectedRun)) S.selectedRun = mine.find((r) => !S.hidden.has(r.id))?.id || null
    if (S.selectedRun) S.logs = await api('GET', `runs/${S.selectedRun}/logs?tail=400`)
    openFirst()
    await dispatch()
  } catch (e) {
    S.error = (await window.argo.ensure()) || null
  }
  render()
}
// Hand subtasks that are waiting for a terminal to a free one running the right CLI.
async function dispatch() {
  for (const r of S.state.runs.filter((r) => ['planning', 'running', 'verifying'].includes(r.status))) {
    const ws = wsOfRun(r), live = termsIn(ws).filter((t) => !t.exited)
    const busy = new Set(runsIn(ws).flatMap((x) => x.tasks).filter((t) => t.delegate?.state === 'sent').map((t) => t.terminal))
    for (const t of r.tasks.filter((t) => t.delegate?.state === 'sent')) if (!live.some((x) => x.name === t.terminal)) await api('POST', `runs/${r.id}/tasks/${t.id}/requeue`).catch(() => {})
    for (const t of r.tasks.filter((t) => t.delegate?.state === 'waiting')) {
      const a = eff(t), target = live.find((x) => x.kind === a.agent && !busy.has(x.name))
      if (!target) continue
      busy.add(target.name)
      const c = await api('POST', `runs/${r.id}/tasks/${t.id}/claim`, { terminal: target.name }).catch(() => null)
      if (!c) continue
      const type = (s, ms) => new Promise((res) => setTimeout(() => { window.argo.pty.write(target.id, s); res() }, ms))
      if (a.agent === 'claude' && a.model) { await type('/model ' + a.model, 0); await type('\r', 300); await type('', 1200) }
      await type(c.line, 0); await type('\r', 400)
    }
  }
}

// ---------- rendering
let stageSig = ''
function render(force) {
  renderSidebar(); renderTop(); renderStrip(); renderChips(); renderBanners(); renderStage(force); renderApprove(); renderComposer(); renderRight()
}
function renderSidebar() {
  $('workspaces').replaceChildren(...workspaceList().map((ws) => {
    const rs = runsIn(ws), ts = termsIn(ws), needs = rs.flatMap((r) => attn(r.id)), active = rs.filter((r) => ['planning', 'running', 'verifying'].includes(r.status)).length
    const counts = [ts.length ? `${ts.length} terminal${ts.length === 1 ? '' : 's'}` : '', active ? `${active} running` : ''].filter(Boolean).join(' · ')
    const where = folderOf(ws) ? ws.replace(S.info.home, '~') : 'no folder'
    return h('button', { class: 'ws' + (ws === S.project ? ' on' : '') + (needs.length ? ' attn' : ''), title: folderOf(ws) || 'A workspace without a folder', onclick: () => select(ws),
      oncontextmenu: (e) => menu(e, [
        { label: 'Rename…', run: () => promptBox('Rename workspace', nameOf(ws), (v) => { if (v.trim()) S.names[ws] = v.trim(); else delete S.names[ws]; save('names', S.names); render() }) },
        { label: S.descriptions[ws] ? 'Edit description…' : 'Add description…', run: () => promptBox('Workspace description', S.descriptions[ws] || '', (v) => { if (v.trim()) S.descriptions[ws] = v.trim().slice(0, 200); else delete S.descriptions[ws]; save('descriptions', S.descriptions); render() }) },
        folderOf(ws) && { label: 'Show in Explorer', run: () => window.argo.open(ws) },
        '-', { label: 'Delete workspace…', run: () => deleteWorkspace(ws) },
      ]) },
      h('b', {}, nameOf(ws)), S.descriptions[ws] && h('small', { class: 'desc' }, S.descriptions[ws]), h('small', {}, needs[0]?.message || (counts ? `${where} · ${counts}` : where)))
  }), h('button', { class: 'ws new', onclick: newWorkspace }, '+  New workspace'))
  $('agents').replaceChildren(...(S.state?.agents || []).map((a) => h('div', { class: 'agent' + (a.installed ? ' ok' : ''), title: a.note || a.version || '' },
    h('i'), h('span', {}, a.label), h('span', {}, a.installed ? (a.id === 'ollama' ? `${a.models.length} model${a.models.length === 1 ? '' : 's'}` : 'ready') : a.note ? 'needs setup' : 'not installed'))))
  $('version').textContent = 'Argo ' + S.info.version
}
const termMenu = (e, beside) => menu(e, KINDS.map(([id, label]) => ({ label: `New ${label} terminal`, disabled: id !== 'shell' && !agent(id)?.installed, run: () => addTerm(id, S.project, beside) })))
function renderTop() {
  const n = termsIn(S.project).length, tpl = load('defaultLayout', null)
  $('topbar').replaceChildren(h('span', { class: 'dim' }, '▣'), h('b', {}, nameOf(S.project)), h('span', { class: 'dim', style: 'font-size:10.5px' }, `${n} terminal${n === 1 ? '' : 's'}`), h('span', { class: 'sp' }),
    h('button', { class: 'icon', onclick: (e) => menu(e, [
      { label: 'Save this layout as default', disabled: !n, run: () => { save('defaultLayout', capture(S.layouts[S.project])); alertBox(`Saved. New workspaces, and Argo the next time it opens, start with these ${n} terminal(s) arranged like this.`) } },
      tpl && { label: 'Open the default layout here', disabled: n > 0, run: () => applyTemplate(tpl, S.project) },
      tpl && { label: 'Clear the default layout', run: () => localStorage.removeItem('defaultLayout') },
    ]) }, '▦ Layout'),
    h('button', { class: 'icon', onclick: (e) => termMenu(e) }, '+ Add member'))
}
function renderStrip() {
  const rs = runsIn(S.project), r = run()
  if (!rs.length) return $('runstrip').replaceChildren()
  $('runstrip').replaceChildren(...rs.map((x) => {
    const on = x.id === S.selectedRun, toggle = () => { if (on) { S.hidden.add(x.id); S.selectedRun = null; S.rightTab = 'Files' } else { S.hidden.delete(x.id); S.selectedRun = x.id } refresh() }
    return h('button', { class: 'runtab' + (on ? ' on' : ''), title: x.goal, onclick: toggle, oncontextmenu: (e) => menu(e, [
      { label: on ? 'Hide agents' : 'Show agents', run: toggle },
      { label: 'Open all subtask panes', run: () => { S.hidden.delete(x.id); S.selectedRun = x.id; x.tasks.forEach((t) => S.openPanes.add(`${x.id}/${t.id}`)); refresh() } },
      { label: 'Close all subtask panes', run: () => { [...S.openPanes].filter((k) => k.startsWith(x.id + '/')).forEach((k) => S.openPanes.delete(k)); render(true) } },
      '-', { label: 'Delete run…', run: () => confirmBox('Delete this run?', `"${x.goal.slice(0, 80)}" and its record, logs and worktrees will be removed. Unmerged work stays on its branch.`, 'Delete run', () => act(() => api('DELETE', 'runs/' + x.id))) },
    ]) }, h('i', { class: 'dot ' + x.status }), h('span', {}, x.goal))
  }), r && h('div', { class: 'meta' }, `${pretty(r.status)} · ${r.isolated === false ? 'no repo' : r.branch}`,
    r.isolated !== false && ['done', 'needs_attention'].includes(r.status) && r.report && h('button', { class: 'btn', disabled: r.applied, onclick: () => act(() => api('POST', `runs/${r.id}/apply`)) }, r.applied ? 'Applied' : `Merge into ${r.baseBranch}`),
    ['planning', 'running', 'verifying'].includes(r.status) && h('button', { class: 'btn', onclick: () => act(() => api('POST', `runs/${r.id}/cancel`)) }, 'Cancel run')))
}
function assignMenu(e, r, t) {
  const a = eff(t), sp = agent(a.agent), set = (body) => act(() => api('PATCH', `runs/${r.id}/tasks/${t.id}`, body))
  menu(e, [
    ...(S.state.agents.filter((x) => x.installed).map((x) => ({ label: (a.agent === x.id ? '✓ ' : '   ') + x.label, run: () => set({ agent: x.id }) }))), '-',
    ...((sp?.models || []).map((m) => ({ label: (a.model === m.id ? '✓ ' : '   ') + (m.id || 'cli default') + ' — ' + m.note, run: () => set({ model: m.id }) }))),
    sp?.reasoning && '-', ...(sp?.reasoning ? ['low', 'medium', 'high'].map((x) => ({ label: (a.reasoning === x ? '✓ ' : '   ') + x + ' reasoning', run: () => set({ reasoning: x }) })) : []),
    t.override && '-', t.override && { label: "Use the orchestrator's choice", run: () => set({ clear: true }) },
  ])
}
function renderChips() {
  const r = run()
  if (!r || !r.tasks.length) return $('subtasks').replaceChildren()
  $('subtasks').replaceChildren(...r.tasks.map((t) => {
    const key = `${r.id}/${t.id}`, open = S.openPanes.has(key), a = eff(t), needs = attn(r.id, t.id).length || t.status === 'failed'
    const who = inTerminal(t) ? (t.terminal || 'waiting for a terminal') : `${agent(a.agent)?.label || '?'} · ${a.model || 'cli default'}`
    return h('button', { class: 'chipbtn' + (open ? ' open' : '') + (needs ? ' attn' : ''), title: t.auto.why || '', onclick: () => { if (inTerminal(t)) return; open ? S.openPanes.delete(key) : S.openPanes.add(key); render(true) },
      oncontextmenu: (e) => ['pending', 'failed', 'needs_attention'].includes(t.status) ? assignMenu(e, r, t) : e.preventDefault() },
      h('i', { class: 'dot ' + t.status }), h('em', {}, t.id), t.title.slice(0, 40), h('em', {}, who + (t.difficulty ? ' · ' + t.difficulty : '') + (t.override ? ' · your choice' : '')))
  }))
}
function renderBanners() {
  const r = run()
  $('banners').replaceChildren(...(r ? r.tasks.filter((t) => t.delegate?.state === 'waiting') : []).map((t) => {
    const a = eff(t), label = agent(a.agent)?.label || 'a CLI'
    return h('div', { class: 'banner' }, h('b', {}, `${t.id}: ${t.title}`), h('span', { class: 'dim' }, `is waiting for a free ${label} terminal.`), h('span', { class: 'sp' }),
      h('button', { class: 'btn', onclick: () => addTerm(a.agent, S.project) }, `Open ${label} terminal`), h('button', { class: 'btn', onclick: () => act(() => api('POST', `runs/${r.id}/tasks/${t.id}/background`)) }, 'Run in background'))
  }))
}
const lineClass = (l) => l.startsWith('✓') ? 'ok' : l.startsWith('✗') || l.includes('error:') ? 'err' : /^(⏺|\$ |✎)/.test(l) ? 'tool' : /^(──|  ⎿|· )/.test(l) ? 'dimline' : ''
function fillLog(el, lines) {
  if (el._n === lines.length && el._last === lines[lines.length - 1]) return
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30
  el.replaceChildren(...lines.map((l) => h('div', { class: lineClass(l) }, l || ' ')))
  el._n = lines.length; el._last = lines[lines.length - 1]
  if (stick) el.scrollTop = el.scrollHeight
}
function split(node, horiz, cells, weights, onResize) {
  const box = h('div', { class: 'split ' + (horiz ? 'h' : 'v') })
  cells.forEach((c, i) => {
    if (i) {
      const g = h('div', { class: 'gutter' })
      g.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        const a = box.children[(i - 1) * 2], b = box.children[i * 2], start = horiz ? ev.clientX : ev.clientY
        const sa = horiz ? a.offsetWidth : a.offsetHeight, sb = horiz ? b.offsetWidth : b.offsetHeight, wa = weights[i - 1], wb = weights[i]
        const move = (e) => {
          const d = Math.max(60 - sa, Math.min(sb - 60, (horiz ? e.clientX : e.clientY) - start)), tot = wa + wb
          weights[i - 1] = tot * (sa + d) / (sa + sb); weights[i] = tot - weights[i - 1]
          a.style.flex = weights[i - 1] + ' 1 0'; b.style.flex = weights[i] + ' 1 0'
          fitAll()
        }
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); onResize?.() }
        addEventListener('mousemove', move); addEventListener('mouseup', up)
      })
      box.append(g)
    }
    box.append(h('div', { class: 'cell', style: `flex:${weights[i]} 1 0` }, c))
  })
  return box
}
const fitAll = () => { for (const t of termsIn(S.project)) if (t.el.isConnected && t.el.clientWidth > 20) try { t.fit.fit() } catch {} }
addEventListener('resize', fitAll)
function termPane(t) {
  const r = run(), job = runsIn(t.ws).flatMap((x) => x.tasks).find((x) => x.terminal === t.name && x.delegate?.state === 'sent')
  const tool = (label, title, fn) => h('button', { class: 'icon', title, onclick: fn }, label)
  const pane = h('div', { class: 'pane' + (S.focused === t.id ? ' active' : ''), onmousedown: () => { if (S.focused !== t.id) { S.focused = t.id; t.mail = null; document.querySelectorAll('.pane.active').forEach((p) => p.classList.remove('active')); pane.classList.add('active'); pane.querySelector('.mail')?.remove() } } },
    h('div', { class: 'tabbar' }, h('div', { class: 'tab' }, '▸ ' + t.name, t.exited && h('span', { class: 'dim' }, 'exited'), job && h('span', { class: 'mail' }, `${job.id}: ${job.title}`), t.mail && h('span', { class: 'mail', title: t.mail }, '✉ ' + t.mail), tool('✕', 'Close this terminal', () => closeTerm(t.id))),
      h('div', { class: 'tools' }, tool('＋', 'New terminal beside this one', (e) => termMenu(e, t.id)), tool('◫', 'Split right', () => addTerm('shell', t.ws, t.id, true)), tool('⬓', 'Split down', () => addTerm('shell', t.ws, t.id, false)))),
    h('div', { class: 'body' }, t.el))
  return pane
}
const layoutView = (n) => n.leaf ? (terms.get(n.leaf) ? termPane(terms.get(n.leaf)) : h('div')) : split(n, n.h, n.kids.map(layoutView), n.w)
function taskPane(r, t) {
  const a = eff(t), needs = attn(r.id, t.id), key = `${r.id}/${t.id}`
  const log = h('div', { class: 'log', 'data-log': t.id })
  const lines = S.logs[t.id] || []
  const body = lines.length ? log : h('div', { class: 'note' }, h('p', {}, t.description), t.dependsOn.length ? h('p', {}, 'waits for ' + t.dependsOn.join(', ')) : null, h('p', {}, 'why: ' + (t.auto.why || '')))
  if (lines.length) fillLog(log, lines)
  return h('div', { class: 'pane' + (needs.length ? ' ring' : '') + (['running', 'merging'].includes(t.status) ? ' active' : '') },
    h('div', { class: 'tabbar' }, h('div', { class: 'tab' }, `▸ ${t.id}: ${t.title}`, h('i', { class: 'dot ' + t.status })),
      h('div', { class: 'tools' }, h('button', { class: 'icon', title: 'Change the agent, model or reasoning', disabled: !['pending', 'failed', 'needs_attention'].includes(t.status), onclick: (e) => assignMenu(e, r, t) }, `${agent(a.agent)?.label || '?'} · ${a.model || 'cli default'}${agent(a.agent)?.reasoning ? ' · ' + a.reasoning : ''}`),
        h('button', { class: 'icon', title: 'Close this pane', onclick: () => { S.openPanes.delete(key); render(true) } }, '✕'))),
    h('div', { class: 'body' }, body),
    needs[0] ? h('div', { class: 'attnbar' }, h('span', {}, needs[0].message.slice(0, 160)), h('span', { class: 'sp' }),
      needs[0].kind === 'permission' && h('button', { class: 'btn primary', onclick: () => act(() => api('POST', `runs/${r.id}/instruct`, { text: 'approve', source: 'windows' })) }, 'Approve'),
      h('button', { class: 'btn', onclick: () => act(() => api('POST', `runs/${r.id}/tasks/${t.id}/retry`, {})) }, 'Retry'),
      h('button', { class: 'btn', onclick: () => act(() => api('POST', `attention/${needs[0].id}/resolve`)) }, 'Dismiss'))
      : t.status === 'failed' ? h('div', { class: 'attnbar' }, h('span', { style: 'color:var(--red)' }, (t.error || 'failed').slice(0, 160)), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: () => act(() => api('POST', `runs/${r.id}/tasks/${t.id}/retry`, {})) }, 'Retry')) : null)
}
function orchPane(r) {
  const log = h('div', { class: 'log', 'data-log': 'orchestrator' })
  fillLog(log, (S.logs.orchestrator || []).filter((l) => !l.startsWith('{')))
  return h('div', { class: 'pane' }, h('div', { class: 'tabbar' }, h('div', { class: 'tab' }, '▸ orchestrator'),
    h('div', { class: 'tools' }, r.planner ? `planned by ${agent(r.planner.agent)?.label || '?'} · ${r.planner.model || ''}` : '', h('button', { class: 'icon', title: 'Close this pane', onclick: () => { S.closedPanes.add(r.id + '/orchestrator'); render(true) } }, '✕'))),
    h('div', { class: 'body' }, log))
}
const stageW = {}
function renderStage(force) {
  const ws = S.project, r = run(), layout = S.layouts[ws], hasT = !!layout && termsIn(ws).length > 0
  const panes = r ? r.tasks.filter((t) => !inTerminal(t) && S.openPanes.has(`${r.id}/${t.id}`)) : []
  const showOrch = !!r && !S.closedPanes.has(r.id + '/orchestrator')
  const sig = JSON.stringify([ws, S.error, layout, [...terms.values()].map((t) => [t.id, t.exited, t.mail]), r?.id, panes.map((t) => [t.id, t.status, !!(S.logs[t.id] || []).length, attn(r.id, t.id).length, eff(t)]), showOrch,
    r && runsIn(ws).flatMap((x) => x.tasks).filter((t) => t.delegate?.state === 'sent').map((t) => t.terminal)])
  if (!force && sig === stageSig) {
    // structure unchanged: only refresh the log text in place
    if (r) document.querySelectorAll('#stage [data-log]').forEach((el) => { const id = el.getAttribute('data-log'); fillLog(el, id === 'orchestrator' ? (S.logs.orchestrator || []).filter((l) => !l.startsWith('{')) : S.logs[id] || []) })
    return
  }
  stageSig = sig
  if (S.error) return $('stage').replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'Orchestrator unavailable'), h('span', {}, S.error)))
  const cells = [], keys = []
  if (hasT) { cells.push(layoutView(layout)); keys.push('terminals') }
  for (const t of panes) { cells.push(taskPane(r, t)); keys.push('pane:' + t.id) }
  if (showOrch) { cells.push(orchPane(r)); keys.push('pane:orchestrator') }
  if (!cells.length) return $('stage').replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'No terminals open'),
    h('span', {}, 'Open a terminal and start Claude, Devin or Codex in it. Tasks you type below are handed to those terminals, so you watch the agents work right there.'), h('button', { class: 'btn large', onclick: (e) => termMenu(e) }, '+ Add member')))
  const w = (stageW[ws] ||= {}), weights = keys.map((k) => w[k] || 1)
  $('stage').replaceChildren(split(null, false, cells, weights, () => keys.forEach((k, i) => (w[k] = weights[i]))))
  requestAnimationFrame(() => { fitAll(); terms.get(S.focused)?.term.focus() })
}
function renderApprove() {
  const r = run()
  if (!r || r.status !== 'awaiting_approval') return $('approve').replaceChildren()
  $('approve').replaceChildren(h('div', {}, h('b', {}, `Plan ready: ${r.tasks.length} subtask${r.tasks.length === 1 ? '' : 's'}`), h('small', {}, 'Each subtask and its agent is listed above. Right-click one to change its agent.')), h('span', { class: 'sp' }),
    h('button', { class: 'btn large', onclick: () => act(() => api('POST', `runs/${r.id}/cancel`)) }, 'Cancel'), h('button', { class: 'btn primary large', onclick: () => act(() => api('POST', `runs/${r.id}/approve`)) }, '▶ Approve & run'))
}
function renderComposer() {
  const r = run(), follow = !S.forceNew && r && !['cancelled', 'failed', 'planning'].includes(r.status)
  $('mode').replaceChildren(...(r ? [[false, 'Follow-up'], [true, 'New task']].map(([v, label]) => h('button', { class: S.forceNew === v ? 'on' : '', onclick: () => { S.forceNew = v; renderComposer() } }, label)) : []))
  $('prompt').placeholder = follow ? 'Tell the agents what to do next…' : folderOf(S.project) ? `Describe one high-level task for ${base(S.project)}…` : 'Ask anything or describe a task. No project needed…'
  $('send').className = $('prompt').value.trim() ? 'ready' : ''
}
function send() {
  const text = $('prompt').value.trim(), r = run(); if (!text) return
  const follow = !S.forceNew && r && !['cancelled', 'failed', 'planning'].includes(r.status)
  $('prompt').value = ''
  act(async () => {
    if (follow) return api('POST', `runs/${r.id}/instruct`, { text, source: 'windows' })
    const hasCLI = termsIn(S.project).some((t) => AGENT_KINDS.includes(t.kind) && !t.exited)
    const made = await api('POST', 'runs', { project: folderOf(S.project), goal: text, terminals: hasCLI })
    S.owner[made.id] = S.project; save('owner', S.owner)
    S.hidden.delete(made.id); S.selectedRun = made.id; S.rightTab = 'Record'; S.forceNew = false
  })
}

// ---------- right panel
function prose(text) {
  const out = h('div', { class: 'prose' }), esc = (s) => s.replace(/`/g, '')
  const inline = (s) => { const span = h('span'); esc(s).split(/(\*\*[^*]+\*\*)/).forEach((p) => span.append(p.startsWith('**') ? h('b', {}, p.slice(2, -2)) : p)); return span }
  let para = [], list = null, table = null, code = null
  const flush = () => { if (para.length) out.append(h('p', {}, inline(para.join(' ')))); para = []; list = null; table = null }
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const t = raw.trim()
    if (t.startsWith('```')) { if (code) { out.append(h('pre', {}, code.join('\n'))); code = null } else { flush(); code = [] } continue }
    if (code) { code.push(raw); continue }
    if (!t) { flush(); continue }
    if (t.startsWith('|') && t.endsWith('|') && t.length > 1) {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim())
      if (cells.every((c) => /^[-: ]+$/.test(c))) continue
      if (!table) { flush(); table = h('table'); out.append(table) }
      table.append(h('tr', {}, cells.map((c) => h(table.children.length ? 'td' : 'th', {}, inline(c)))))
      continue
    }
    const hd = t.match(/^(#{1,6})\s+(.*)$/), bl = t.match(/^[-*•]\s+(.*)$/), nm = t.match(/^\d+[.)]\s+(.*)$/)
    if (hd) { flush(); out.append(h('h3', {}, inline(hd[2]))) }
    else if (bl || nm) { if (para.length || table) flush(); const tag = bl ? 'ul' : 'ol'; if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); out.append(list) } list.append(h('li', {}, inline((bl || nm)[1]))) }
    else { if (list || table) flush(); para.push(t) }
  }
  if (code) out.append(h('pre', {}, code.join('\n')))
  flush()
  return out
}
const sect = (title, ...kids) => h('div', { class: 'sect' }, h('h5', {}, title), kids)
const bullets = (items, empty) => items.length ? prose(items.map((i) => '- ' + i.replace(/\n/g, ' ')).join('\n')) : h('span', { class: 'dim' }, empty)
async function fileRows(dir, depth, out) {
  const list = (S.dirs[dir] ||= await window.argo.listDir(dir))
  for (const e of list) {
    out.push(h('div', { class: 'file' + (S.selectedFile === e.path ? ' sel' : ''), style: `padding-left:${12 + depth * 14}px`, title: e.path,
      onclick: () => { S.selectedFile = e.path; if (e.dir) S.expanded.has(e.path) ? S.expanded.delete(e.path) : S.expanded.add(e.path); renderRight() },
      ondblclick: () => !e.dir && window.argo.open(e.path),
      oncontextmenu: (ev) => menu(ev, [{ label: 'Show in Explorer', run: () => window.argo.reveal(e.path) }, { label: 'Copy path', run: () => navigator.clipboard.writeText(e.path) }]) },
      h('i', {}, e.dir ? (S.expanded.has(e.path) ? '▾' : '▸') : ''), e.dir ? '📁' : '📄', e.name))
    if (e.dir && S.expanded.has(e.path) && depth < 12) await fileRows(e.path, depth + 1, out)
  }
}
let rightToken = 0
async function renderRight() {
  const r = run(), tabs = r ? ['Files', 'Record', 'Report'] : ['Files'], tab = tabs.includes(S.rightTab) ? S.rightTab : 'Files'
  $('rtabs').replaceChildren(...tabs.map((t) => h('button', { class: t === tab ? 'on' : '', onclick: () => { S.rightTab = t; renderRight() } }, t)))
  const sig = JSON.stringify([tab, tab === 'Files' ? [S.project, [...S.expanded], S.selectedFile, Object.keys(S.dirs).length] : [r?.id, r?.status, r?.decisions.length, r?.followups.length, r?.tasks.map((t) => [t.status, t.changedFiles.length, eff(t)]), !!r?.report]])
  if (sig === renderRight.sig) return
  renderRight.sig = sig
  if (tab === 'Files') {
    const root = folderOf(S.project) || S.info.home, rows = [], token = ++rightToken
    await fileRows(root, 0, rows)
    if (token !== rightToken) return
    return $('rbody').replaceChildren(h('div', { class: 'path' }, '📁 ' + root.replace(S.info.home, '~'), h('span', { style: 'flex:1' }), h('button', { class: 'icon', title: 'Reload', onclick: () => { S.dirs = {}; renderRight.sig = ''; renderRight() } }, '⟳')), ...rows)
  }
  if (tab === 'Record') {
    const authors = [...new Set(r.decisions.map((d) => d.by))]
    return $('rbody').replaceChildren(sect('Goal', prose(r.goal)), sect('Constraints', bullets(r.constraints, 'None stated')),
      sect('Follow-ups', r.followups.length ? r.followups.map((f) => h('div', {}, h('div', { class: 'who' }, pretty(f.source).replace(/-/g, ' ')), prose(f.text))) : h('span', { class: 'dim' }, 'None')),
      sect('Decisions', authors.length ? authors.map((by) => h('div', {}, h('div', { class: 'who' }, [agent(by.split('/')[0])?.label || by.split('/')[0], ...by.split('/').slice(1)].join(' · ')), bullets(r.decisions.filter((d) => d.by === by && !d.text.startsWith('#')).map((d) => d.text), 'None'))) : h('span', { class: 'dim' }, 'None yet')),
      sect('Who did what', r.tasks.map((t) => { const a = eff(t); return h('div', { style: 'margin-bottom:8px' }, h('div', { class: 'row' }, h('i', { class: 'dot ' + t.status }), h('b', { style: 'font-size:12px;font-weight:500' }, t.title)),
        h('div', { class: 'who', style: 'padding-left:15px' }, `${agent(a.agent)?.label || '?'} · ${a.model || 'default model'}${t.difficulty ? ' · ' + t.difficulty : ''}${t.override ? ' · your choice' : ''}`), t.changedFiles.map((f) => h('div', { class: 'dim', style: 'padding-left:15px;font-size:11.5px' }, f))) })))
  }
  const rep = r.report
  if (!rep) return $('rbody').replaceChildren(sect(r.error ? 'Problem' : 'Report', r.error ? prose(r.error) : h('span', { class: 'dim' }, 'The report appears once every subtask has finished and the review is in.')))
  $('rbody').replaceChildren(rep.answer ? sect('Answer', prose(rep.answer)) : '', sect('Completed', bullets(rep.completed, 'Nothing')), sect('Needs attention', bullets(rep.attention, 'Nothing')),
    sect('Checks', rep.checks.length ? rep.checks.map((c) => h('div', {}, (c.ok ? '✓ ' : '✗ ') + c.command, !c.ok && h('pre', { style: 'font:10px Consolas,monospace;white-space:pre-wrap;color:var(--dim)' }, c.output.slice(-600)))) : h('span', { class: 'dim' }, 'No checks were configured or detected.')),
    sect('Reviewed by', rep.reviewedBy || '-'), rep.changedFiles.length ? sect(`Changed files (${rep.changedFiles.length})`, rep.changedFiles.map((f) => h('div', { style: 'font-size:11.5px' }, f))) : '')
}

// ---------- settings
function openSettings() {
  const s = structuredClone(S.state.settings), theme = localStorage.getItem('theme') || 'dark', inst = S.state.agents.filter((a) => a.installed)
  const sel = (value, opts, on) => { const e = h('select', { onchange: () => on(e.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))); return e }
  let themeNow = theme
  const themeSeg = h('div', { class: 'seg' })
  const paintTheme = () => themeSeg.replaceChildren(...[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('button', { class: v === themeNow ? 'on' : '', onclick: () => { themeNow = v; paintTheme() } }, l)))
  paintTheme()
  const checks = h('input', { type: 'text', value: s.checks.join(' ; '), placeholder: 'empty = detect from the project' })
  const par = h('input', { type: 'number', min: 1, max: 8, value: s.maxParallel, style: 'min-width:70px;width:70px' })
  const auto = h('input', { type: 'checkbox', checked: s.autoApprove })
  modal(h('div', { class: 'dialog' }, h('h3', {}, 'Settings'),
    h('label', {}, 'Theme', themeSeg),
    h('label', {}, 'Default CLI', sel(s.defaultAgent, [['auto', 'Auto: the orchestrator picks per subtask'], ...inst.map((a) => [a.id, a.label])], (v) => (s.defaultAgent = v))),
    inst.map((a) => h('label', {}, a.label + ' model', sel(s.models[a.id] ?? '__default', [['__default', 'By difficulty'], ...a.models.map((m) => [m.id, (m.id || 'cli default') + ' — ' + m.note])], (v) => { if (v === '__default') delete s.models[a.id]; else s.models[a.id] = v }))),
    h('label', {}, 'Reasoning for planning and review', sel(s.reasoning, [['low', 'low'], ['medium', 'medium'], ['high', 'high']], (v) => (s.reasoning = v))),
    h('label', {}, 'Parallel agents', par), h('label', {}, 'Run plans without waiting for my approval', auto), h('label', {}, 'Checks', checks),
    h('div', { class: 'foot' }, h('button', { class: 'btn large', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary large', onclick: () => {
      localStorage.setItem('theme', themeNow); applyTheme(); closeModal()
      // a model the user un-pinned has to be removed on the server too, which only replaces what it is sent
      const models = Object.fromEntries(inst.filter((a) => s.models[a.id] !== undefined).map((a) => [a.id, s.models[a.id]]))
      act(() => api('PUT', 'settings', { defaultAgent: s.defaultAgent, models, reasoning: s.reasoning, maxParallel: Number(par.value) || 3, autoApprove: auto.checked, checks: checks.value.split(';').map((c) => c.trim()).filter(Boolean) }))
    } }, 'Save'))))
}
function applyTheme() {
  const t = localStorage.getItem('theme') || 'dark', light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.classList.toggle('light', light)
  for (const x of terms.values()) x.term.options.theme = termTheme()
}

// ---------- start
$('newTermBtn').onclick = (e) => { e.stopPropagation(); termMenu(e) }
$('openFolderBtn').onclick = openFolder
$('settingsBtn').onclick = () => S.state && openSettings()
$('send').onclick = send
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
$('prompt').addEventListener('input', renderComposer)
;(async () => {
  applyTheme()
  S.info = await window.argo.info()
  S.error = await window.argo.ensure()
  await refresh()
  setInterval(refresh, 1200)
})()
