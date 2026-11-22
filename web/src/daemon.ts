import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HttpError } from 'wasp/server'

// The orchestrator listens on loopback only. This server runs on the same Mac and is the
// only thing that talks to it, so the phone never holds the orchestrator's token.
function config(): { token: string; port: number } {
  try {
    return JSON.parse(readFileSync(join(process.env.ARGO_HOME || join(homedir(), '.argo'), 'config.json'), 'utf8'))
  } catch {
    throw new HttpError(503, 'The Argo Mac app has not been started on this computer yet.')
  }
}

export async function daemon<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const { token, port } = config()
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new HttpError(503, 'The orchestrator is not running. Open the Argo app on your Mac.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(res.status === 401 ? 502 : res.status, data.error || `Orchestrator error ${res.status}`)
  return data as T
}
