import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { fitWithin } from '../../utils/shifts'
import { cameraErrorMessage } from '../../utils/camera'

// Takes the shift selfie inside the page (live front-camera view + "Take
// photo"). Opening the phone's separate camera app made Android close the
// browser to free memory ("low memory"), losing the photo. The picture is
// captured at most 1280 px, so it stays small.
const MAX_SIDE = 1280

export default function SelfieCamera({ onCapture, onCancel, onFallback }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  // Decided once: a browser without getUserMedia can't open the camera in the page.
  const [error, setError] = useState(() => (
    navigator.mediaDevices?.getUserMedia ? '' : cameraErrorMessage({ name: 'Unsupported' })
  ))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) return undefined
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: MAX_SIDE }, height: { ideal: MAX_SIDE } },
      audio: false,
    }).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      video.srcObject = stream
      video.play().then(() => { if (!cancelled) setReady(true) }).catch(() => {})
    }).catch((err) => {
      if (!cancelled) setError(cameraErrorMessage(err))
    })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const take = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    setBusy(true)
    const { width, height } = fitWithin(video.videoWidth, video.videoHeight, MAX_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(video, 0, 0, width, height)
    canvas.toBlob((blob) => {
      setBusy(false)
      if (!blob) {
        setError('Could not take the photo. Please try again.')
        return
      }
      streamRef.current?.getTracks().forEach(t => t.stop())
      onCapture(new File([blob], 'selfie.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.8)
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-red-400 text-sm" role="alert">{error}</p>
        {onFallback && (
          <button type="button" onClick={onFallback} className="btn-gold w-full min-h-11">Use the phone camera instead</button>
        )}
        <button type="button" onClick={onCancel} className="btn-outline w-full min-h-11 text-xs uppercase tracking-widest">Cancel</button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Mirrored like a mirror; the saved photo is not mirrored. */}
      <video ref={videoRef} className="w-full rounded-xl bg-black aspect-[3/4] object-cover -scale-x-100" muted playsInline aria-label="Front camera" />
      <button type="button" onClick={take} disabled={!ready || busy} className="btn-gold w-full min-h-11 inline-flex items-center justify-center gap-2">
        <Camera size={18} aria-hidden="true" /> {ready ? (busy ? 'Taking…' : 'Take photo') : 'Opening camera…'}
      </button>
      <button type="button" onClick={onCancel} className="btn-outline w-full min-h-11 text-xs uppercase tracking-widest">Cancel</button>
    </div>
  )
}
