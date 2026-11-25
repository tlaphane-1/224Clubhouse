import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'

// Live camera QR scanner for the counter tablet. Rear camera by default
// (facing='user' for the table, where the customer holds up their phone),
// reports each new code once, and always releases the camera on close.
export default function QrScanner({ onCode, onClose, facing = 'environment' }) {
  const videoRef = useRef(null)
  const lastRef = useRef({ text: '', at: 0 })
  const onCodeRef = useRef(onCode)
  const [error, setError] = useState('')

  useEffect(() => { onCodeRef.current = onCode }, [onCode])

  useEffect(() => {
    let controls
    let cancelled = false
    const reader = new BrowserQRCodeReader()
    reader.decodeFromConstraints(
      { video: { facingMode: { ideal: facing } } },
      videoRef.current,
      (result) => {
        if (!result) return
        const text = result.getText()
        const now = Date.now()
        // The same label stays in view for a while: one scan per 2 seconds.
        if (text === lastRef.current.text && now - lastRef.current.at < 2000) return
        lastRef.current = { text, at: now }
        onCodeRef.current(text)
      },
    ).then((c) => {
      if (cancelled) c.stop()
      else controls = c
    }).catch((err) => {
      if (cancelled) return
      setError(err?.name === 'NotAllowedError'
        ? 'Camera blocked — allow camera access for this site, then try again.'
        : 'Could not open the camera.')
    })
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [facing])

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-red-400 text-sm" role="alert">{error}</p>
      ) : (
        <video ref={videoRef} className="w-full rounded-xl bg-black aspect-video object-cover" muted playsInline aria-label="Camera view for scanning labels" />
      )}
      <button type="button" onClick={onClose} className="btn-outline w-full min-h-11 text-xs uppercase tracking-widest">
        Done scanning
      </button>
    </div>
  )
}
