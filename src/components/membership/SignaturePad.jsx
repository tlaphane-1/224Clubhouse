import { useEffect, useRef, useState } from 'react'
import tailwindConfig from '../../../tailwind.config.js'

const INK = tailwindConfig.theme.extend.colors.ink

// Sign with a finger (or mouse/pen) like on paper. Reports a transparent PNG
// data URL through onChange, or null when cleared. `touch-none` stops the page
// scrolling while the applicant signs.
export default function SignaturePad({ id, onChange, invalid = false }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  // A ref, not state: end() runs in the same render as the first move(), so
  // state would still read false and the first stroke would never be reported.
  const inked = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  // Size the drawing surface to the box (capped at 2x pixel density so the
  // saved image stays small).
  useEffect(() => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.4
    ctx.strokeStyle = INK
  }, [])

  const pointOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const start = (e) => {
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    last.current = pointOf(e)
  }

  const move = (e) => {
    if (!drawing.current) return
    const ctx = canvasRef.current.getContext('2d')
    // Coalesced events give a smoother line on fast strokes where supported.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) {
      const p = pointOf(ev)
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      last.current = p
    }
    inked.current = true
    if (!hasInk) setHasInk(true)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (inked.current) onChange?.(canvasRef.current.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    inked.current = false
    setHasInk(false)
    onChange?.(null)
  }

  return (
    <div>
      <div className={`relative border-b-2 ${invalid ? 'border-red-600' : 'border-print/60'}`}>
        <canvas
          id={id}
          ref={canvasRef}
          tabIndex={-1}
          role="img"
          aria-label="Signature box. Draw your signature with your finger."
          className="block w-full h-28 touch-none cursor-crosshair focus:outline-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!hasInk && (
          <span className="pointer-events-none absolute left-2 bottom-2 font-hand text-2xl text-paper-line select-none">
            ✕ Sign here
          </span>
        )}
      </div>
      {hasInk && (
        <button
          type="button"
          onClick={clear}
          className="focus-ring rounded h-11 px-2 -ml-2 text-print/70 underline underline-offset-2 text-sm"
        >
          Clear signature
        </button>
      )}
    </div>
  )
}
