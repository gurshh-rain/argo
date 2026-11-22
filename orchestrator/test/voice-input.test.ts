import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'argo-voice-test-'))
const saved = Object.fromEntries(['ARGO_HOME', 'ELEVENLABS_API_KEY', 'ELEVENLABS_STT_MODEL'].map((key) => [key, process.env[key]]))
process.env.ARGO_HOME = home
delete process.env.ELEVENLABS_API_KEY
delete process.env.ELEVENLABS_STT_MODEL
const apiKey = 'synthetic-elevenlabs-key'
writeFileSync(join(home, '.env'), `ELEVENLABS_API_KEY=${apiKey}\nELEVENLABS_STT_MODEL=scribe_v2\n`, { mode: 0o600 })
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(home, { recursive: true, force: true })
})
const { transcribe } = await import('../src/voice.ts')

test('native MP4 dictation reaches the provider as multipart audio and returns editable text', async (t) => {
  const audio = Buffer.from('synthetic audio fixture, not a microphone recording')
  const provider = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init)
    assert.equal(request.url, 'https://api.elevenlabs.io/v1/speech-to-text')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('xi-api-key'), apiKey)
    assert.match(request.headers.get('content-type') || '', /^multipart\/form-data; boundary=/)
    const form = await request.formData()
    assert.equal(form.get('model_id'), 'scribe_v2')
    const file = form.get('file')
    assert.ok(file instanceof File)
    assert.equal(file.type, 'audio/mp4')
    assert.match(file.name, /\.(mp4|m4a)$/)
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio)
    return Response.json({ text: '  Build the login page. 中文\n' })
  })

  assert.equal(await transcribe(audio, 'audio/mp4'), 'Build the login page. 中文')
  assert.equal(provider.mock.callCount(), 1)
})

test('dictation without an ElevenLabs key fails before any provider request', async (t) => {
  delete process.env.ELEVENLABS_API_KEY
  const provider = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No provider request should be made without credentials')
  })

  await assert.rejects(transcribe(Buffer.from('synthetic audio'), 'audio/mp4'), /ELEVENLABS_API_KEY/)
  assert.equal(provider.mock.callCount(), 0)
})
