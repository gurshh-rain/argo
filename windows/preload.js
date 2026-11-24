const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('argo', {
  api: (method, route, body) => ipcRenderer.invoke('api', method, route, body),
  ensure: () => ipcRenderer.invoke('ensure'),
  info: () => ipcRenderer.invoke('info'),
  chooseFolder: () => ipcRenderer.invoke('chooseFolder'),
  listDir: (dir) => ipcRenderer.invoke('listDir', dir),
  open: (p) => ipcRenderer.invoke('open', p),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  pty: {
    create: (o) => ipcRenderer.invoke('pty:create', o),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (fn) => ipcRenderer.on('pty:data', (_e, id, data) => fn(id, data)),
    onExit: (fn) => ipcRenderer.on('pty:exit', (_e, id) => fn(id)),
  },
  onMail: (fn) => ipcRenderer.on('mail', (_e, id, from, text) => fn(id, from, text)),
})
