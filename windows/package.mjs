// Packages Argo for Windows into windows/dist/Argo-win32-x64/ (Argo.exe plus its files) and zips it.
// With the release key present it also writes dist/latest-win.json, the signed manifest the in-app updater
// reads: attach it to the GitHub release next to Argo-win32-x64.zip.
// Run on Windows for a build whose terminals work: the terminal library is native and is fetched for
// the machine that runs `npm install`.
import { packager } from '@electron/packager'
import { cpSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const platform = process.argv[2] || 'win32', arch = process.argv[3] || 'x64'
rmSync(join(here, 'dist'), { recursive: true, force: true })
const [out] = await packager({
  dir: here, out: join(here, 'dist'), name: 'Argo', platform, arch, overwrite: true, asar: false, icon: join(here, 'assets', 'icon.ico'),
  win32metadata: { CompanyName: 'Argo', FileDescription: 'Argo', ProductName: 'Argo' },
  ignore: [/^\/dist($|\/)/, /^\/package\.mjs$/, /^\/README\.md$/],
  // the orchestrator ships beside the app, exactly as the Mac build bundles it
  afterCopy: [async (first, ...rest) => {
    // packager 20 passes one object; older versions pass (buildPath, ..., done)
    const buildPath = typeof first === 'string' ? first : first.buildPath
    cpSync(join(here, '..', 'orchestrator', 'src'), join(buildPath, '..', 'orchestrator', 'src'), { recursive: true })
    cpSync(join(here, '..', 'orchestrator', 'package.json'), join(buildPath, '..', 'orchestrator', 'package.json'))
    const done = rest[rest.length - 1]
    if (typeof done === 'function') done()
  }],
})
console.log('Built', out)
if (platform === 'win32' && !existsSync(join(here, 'node_modules', '@lydell', `node-pty-win32-${arch}`)))
  console.warn(`\nWARNING: the Windows terminal library (@lydell/node-pty-win32-${arch}) is not installed here, so terminals will not open in this build.\nPackage on Windows, or run: npm install --no-save --force @lydell/node-pty-win32-${arch}@1.1.0`)
const zip = `${out}.zip`
try {
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'zip', process.platform === 'win32' ? ['-a', '-c', '-f', zip, '-C', dirname(out), 'Argo-' + platform + '-' + arch] : ['-qr', zip, 'Argo-' + platform + '-' + arch], { cwd: dirname(out) })
  console.log('Zipped', zip)
} catch (e) { console.warn('Could not zip:', e.message) }

// The in-app updater installs only a zip signed with the release key (the one the Mac build uses), whose
// public half is in update.js. latest-win.json tells installed copies what to fetch.
const keyFile = process.env.ARGO_PRIVATE_KEY_FILE || join(homedir(), '.argo-signing', 'ed25519.key')
if (platform === 'win32' && existsSync(zip) && existsSync(keyFile)) {
  const require = createRequire(import.meta.url)
  const { verify, PUBLIC_KEY } = require('./update.js'), { version } = require('./package.json')
  // the key file holds the raw 32-byte private key in base64; wrap it in its fixed PKCS#8 header
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')]), format: 'der', type: 'pkcs8' })
  const signature = sign(null, readFileSync(zip), key).toString('base64')
  const mine = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  // refuse to publish something the app would reject
  if (mine !== PUBLIC_KEY) throw new Error(`The key at ${keyFile} is not the release key the app trusts.`)
  verify(zip, signature)
  writeFileSync(join(here, 'dist', 'latest-win.json'), JSON.stringify({ version, notes: '', url: `https://github.com/gurshh-rain/argo/releases/download/v${version}/Argo-${platform}-${arch}.zip`, signature }, null, 2) + '\n')
  console.log('Wrote dist/latest-win.json for', version)
} else if (platform === 'win32') console.warn(`No signing key at ${keyFile}: latest-win.json not written, so installed copies will not see this release.`)
