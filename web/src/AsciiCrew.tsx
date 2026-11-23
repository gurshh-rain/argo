import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'

const density = '.:-=+*#%@'

function gridFor(width: number, height: number) {
  const columns = width < 500 ? 70 : 120
  const rows = 28
  const markHeight = width < 500 ? 17 : 23
  const markWidth = Math.round(markHeight * (height / rows) / (width / columns) * 1.24)
  return { columns, rows, markWidth, markHeight }
}

/** A character-only illustration; the existing logo supplies its silhouette. */
export function AsciiCrew({ className = '' }: { className?: string }) {
  const host = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const introduced = useRef(false)
  const [animated, setAnimated] = useState(true)

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { if (preference.matches) setAnimated(false) }
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const element = host.current
    const surface = canvas.current
    const context = surface?.getContext('2d')
    if (!element || !surface || !context) return

    let width = 0
    let height = 0
    let visible = false
    let phase = 0
    let introStartedAt: number | null = null
    let reveal = introduced.current || !animated ? 1 : 0
    if (!animated) introduced.current = true
    let pointer: { x: number; y: number } | null = null
    let pixels: Uint8ClampedArray | null = null
    let disposed = false
    const logo = new Image()
    const sample = document.createElement('canvas')
    const sampleContext = sample.getContext('2d', { willReadFrequently: true })

    function draw() {
      if (!context || !width) return
      const light = document.documentElement.dataset.theme === 'light'
      const ink = light ? '#404040' : '#dedede'
      const accent = light ? '#202020' : '#ffffff'
      const faint = light ? '#c4c4c4' : '#3e3e3e'
      const { columns, rows, markWidth, markHeight } = gridFor(width, height)
      const cellWidth = width / columns
      const cellHeight = height / rows
      const left = Math.floor((columns - markWidth) / 2)
      const top = Math.floor((rows - markHeight) / 2)
      context.clearRect(0, 0, width, height)
      context.font = `${Math.min(cellWidth * 1.55, cellHeight)}px ui-monospace, SFMono-Regular, Menlo, monospace`
      context.textAlign = 'center'
      context.textBaseline = 'middle'

      const character = (char: string, x: number, y: number, color: string, alpha = 1) => {
        context.globalAlpha = alpha
        context.fillStyle = color
        context.fillText(char, (x + .5) * cellWidth, (y + .5) * cellHeight)
      }

      // Quiet, deterministic stars keep paused and reduced-motion frames complete.
      for (let i = 0; i < 55; i++) {
        const x = (i * 37 + 11) % columns
        const y = (i * 13 + 7) % rows
        if (x > left - 3 && x < left + markWidth + 3 && y > top - 2 && y < top + markHeight + 2) continue
        character(i % 9 === 0 ? '+' : '.', x, y, faint, .65)
      }

      // The surrounding character contours make the network read as a complete scene.
      for (let ring = 0; ring < 3; ring++) {
        const radiusX = columns * (.28 + ring * .075)
        const radiusY = rows * (.25 + ring * .07)
        // Solid hairline contours (no dotted lines), with a "+" every eighth of the way round.
        context.globalAlpha = .35
        context.strokeStyle = faint
        context.lineWidth = 1
        context.beginPath()
        context.ellipse(width / 2, height / 2, radiusX * cellWidth, radiusY * cellHeight, 0, 0, Math.PI * 2)
        context.stroke()
        for (let step = 0; step < 8; step++) {
          const angle = step / 8 * Math.PI * 2
          const x = columns / 2 + Math.cos(angle) * radiusX - .5
          const y = rows / 2 + Math.sin(angle) * radiusY - .5
          if (x > left - 2 && x < left + markWidth + 2 && y > top - 1 && y < top + markHeight + 1) continue
          character('+', x, y, faint, .55)
        }
      }

      const routes = [
        { x: 4, y: 8, bend: -5, endX: left + 3, endY: 12 },
        { x: columns - 5, y: 9, bend: 5, endX: left + markWidth - 4, endY: 15 },
        { x: columns / 2, y: rows - 2, bend: 12, endX: columns / 2 + 6, endY: top + markHeight - 3 },
      ]
      routes.forEach((route, routeIndex) => {
        const point = (t: number) => ({
          x: route.x + (route.endX - route.x) * t + Math.sin(t * Math.PI) * route.bend,
          y: route.y + (route.endY - route.y) * t,
        })
        context.globalAlpha = .7
        context.strokeStyle = faint
        context.lineWidth = 1
        context.beginPath()
        for (let step = 0; step <= 48; step++) {
          const p = point(step / 48)
          const sx = (p.x + .5) * cellWidth, sy = (p.y + .5) * cellHeight
          if (step) context.lineTo(sx, sy)
          else context.moveTo(sx, sy)
        }
        context.stroke()
        const packet = point((phase + routeIndex / 3) % 1)
        character('+', packet.x, packet.y, accent)
      })

      if (pixels) {
        for (let y = 0; y < markHeight; y++) {
          for (let x = 0; x < markWidth; x++) {
            if ((x * 17 + y * 31) % 101 / 101 > reveal) continue
            const intensity = pixels[(y * markWidth + x) * 4] / 255
            if (intensity < .1) continue
            const screenX = (left + x + .5) * cellWidth
            const screenY = (top + y + .5) * cellHeight
            const nearPointer = pointer && Math.hypot(pointer.x - screenX, pointer.y - screenY) < 85
            const charIndex = intensity > .8 ? 5 + (x * 7 + y * 3) % 4 : Math.floor(intensity * (density.length - 1))
            character(density[charIndex], left + x, top + y, nearPointer ? accent : ink, .55 + intensity * .45)
          }
        }
      }
      context.globalAlpha = 1
    }

    function resize() {
      if (!element || !surface || !context) return
      const bounds = element.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      if (!width || !height) return
      const ratio = Math.min(devicePixelRatio || 1, 2)
      surface.width = Math.round(width * ratio)
      surface.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      if (logo.complete && logo.naturalWidth && sampleContext) {
        const grid = gridFor(width, height)
        sample.width = grid.markWidth
        sample.height = grid.markHeight
        sampleContext.drawImage(logo, 350, 700, 1140, 920, 0, 0, sample.width, sample.height)
        pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data
      }
      draw()
    }

    logo.onload = () => { if (!disposed) resize() }
    logo.src = '/media/argo.png'
    const sizing = new ResizeObserver(resize)
    sizing.observe(element)
    const viewing = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible && introStartedAt === null) introStartedAt = performance.now()
    }, { threshold: .05 })
    viewing.observe(element)
    const theme = new MutationObserver(draw)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const move = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect()
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      draw()
    }
    const leave = () => { pointer = null; draw() }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    resize()
    const timer = animated ? setInterval(() => {
      if (!visible || document.hidden) return
      if (introStartedAt !== null && !introduced.current) {
        reveal = Math.min(1, (performance.now() - introStartedAt) / 850)
        if (reveal === 1) introduced.current = true
      }
      phase = (phase + .035) % 1
      draw()
    }, 125) : null

    return () => {
      disposed = true
      if (timer) clearInterval(timer)
      sizing.disconnect()
      viewing.disconnect()
      theme.disconnect()
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
      logo.onload = null
    }
  }, [animated])

  return <figure className={`cv-ascii ${className}`} ref={host} aria-label="An ASCII Argo mark connects Claude Code, Codex and Devin with flowing character trails.">
    <canvas ref={canvas} aria-hidden="true" />
    <span className="cv-ascii-label cv-ascii-claude">Claude Code</span>
    <span className="cv-ascii-label cv-ascii-codex">Codex</span>
    <span className="cv-ascii-label cv-ascii-devin">Devin</span>
    <button type="button" className="cv-ascii-motion icon-button" onClick={() => setAnimated(value => !value)} aria-label={animated ? 'Pause ASCII animation' : 'Play ASCII animation'} title={animated ? 'Pause ASCII animation' : 'Play ASCII animation'}><Icon name={animated ? 'pause' : 'play'} width="14" height="14" /></button>
  </figure>
}
