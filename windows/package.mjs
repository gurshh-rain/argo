// Packages Argo for Windows into windows/dist/Argo-win32-x64/ (Argo.exe plus its files) and zips it.
// Run on Windows for a build whose terminals work: the terminal library is native and is fetched for
// the machine that runs `npm install`.
import { packager } from '@electron/packager'
import { cpSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const platform = process.argv[2] || 'win32', arch = process.argv[3] || 'x64'
rmSync(join(here, 'dist'), { recursive: true, force: true })
const [out] = await packager({
  dir: here, out: join(here, 'dist'), name: 'Argo', platform, arch, overwrite: true, asar: false,
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
try {
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'zip', process.platform === 'win32' ? ['-a', '-c', '-f', `${out}.zip`, '-C', dirname(out), 'Argo-' + platform + '-' + arch] : ['-qr', `${out}.zip`, 'Argo-' + platform + '-' + arch], { cwd: dirname(out) })
  console.log('Zipped', out + '.zip')
} catch (e) { console.warn('Could not zip:', e.message) }
