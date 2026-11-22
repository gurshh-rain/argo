// Microphone capture for the phone console. Prefers recording audio for ElevenLabs Scribe;
// falls back to the browser's own speech recognition when ElevenLabs is not configured.

export type Recorder = { stop: () => Promise<{ text?: string; audio?: string; mime?: string }> }

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

export async function record(useServerStt: boolean): Promise<Recorder> {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!useServerStt) {
    if (!SR) throw new Error('This browser has no speech recognition. Add an ElevenLabs key on the Mac, or type instead.')
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = navigator.language || 'en-US'
    let text = ''
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript + ' '
    }
    const ended = new Promise<void>((resolve) => (rec.onend = () => resolve()))
    rec.start()
    return { stop: async () => (rec.stop(), await ended, { text: text.trim() }) }
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS. Open this page through the tunnel address.')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = ['audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((resolve) => (mr.onstop = () => resolve()))
  mr.start()
  return {
    stop: async () => {
      mr.stop()
      await stopped
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })
      return { audio: await toBase64(blob), mime: blob.type }
    },
  }
}

export function say(out: { text: string; audio?: string; mime?: string }) {
  if (out.audio) return void new Audio(`data:${out.mime || 'audio/mpeg'};base64,${out.audio}`).play()
  speechSynthesis.cancel()
  speechSynthesis.speak(new SpeechSynthesisUtterance(out.text))
}
