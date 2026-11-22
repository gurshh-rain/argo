import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Settings } from './types.ts'

export const HOME = process.env.ARGO_HOME || join(homedir(), '.argo')
export const WORKTREES = join(HOME, 'worktrees')
const CONFIG_FILE = join(HOME, 'config.json')
const ENV_FILE = join(HOME, '.env')

export interface Config {
  token: string
  port: number
  projects: string[]
  settings: Settings
}

const defaultSettings: Settings = {
  defaultAgent: 'auto',
  models: {},
  reasoning: 'medium',
  autoApprove: false,
  maxParallel: 3,
  checks: [],
  callOnAttention: true,
  phoneNumber: '',
  publicUrl: '',
}

let cached: Config | undefined

export function loadConfig(): Config {
  if (cached) return cached
  mkdirSync(WORKTREES, { recursive: true })
  let raw: Partial<Config> = {}
  if (existsSync(CONFIG_FILE)) raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  cached = {
    token: raw.token || randomBytes(24).toString('base64url'),
    port: Number(process.env.ARGO_PORT) || raw.port || 4317,
    projects: raw.projects || [],
    settings: { ...defaultSettings, ...raw.settings },
  }
  saveConfig()
  return cached
}

export function saveConfig() {
  if (!cached) return
  writeFileSync(CONFIG_FILE, JSON.stringify(cached, null, 2))
  chmodSync(CONFIG_FILE, 0o600)
}

// Secrets live in the environment or ~/.argo/.env, never in the repo.
let envLoaded = false
export function secret(name: string): string {
  if (!envLoaded) {
    envLoaded = true
    if (existsSync(ENV_FILE))
      for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
  }
  return process.env[name] || ''
}

export function integrations() {
  return {
    elevenlabs: !!secret('ELEVENLABS_API_KEY'),
    phoneCalls: !!(secret('ELEVENLABS_API_KEY') && secret('ELEVENLABS_AGENT_ID') && secret('ELEVENLABS_PHONE_NUMBER_ID')),
    maritime: !!secret('MARITIME_API_KEY'),
  }
}
