import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, LogOut as EndIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMyOpenShift, useStartShift, useEndShift, useSelfieUrl } from '../../hooks/useShifts'
import { shiftStatusLabel } from '../../utils/shifts'
import SelfieCamera from './SelfieCamera'

// Start a shift with a selfie (front camera on phones/tablets), end it later.
// The server stamps both times.
export default function ShiftPanel() {
  const shift = useMyOpenShift()
  const start = useStartShift()
  const end = useEndShift()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const selfie = useSelfieUrl(shift.data?.selfie_path)

  // Keep "2h 14m" moving while the page is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Preview URL for the chosen photo, released when it changes or unmounts.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const choose = (e) => {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    setError('')
    setFile(picked)
  }

  const confirmStart = async () => {
    setError('')
    try {
      await start.mutateAsync(file)
      setFile(null)
      toast.success('Shift started')
    } catch (err) {
      const msg = err?.message || 'Could not start your shift'
      // Already on shift (another tab, a double tap): the refetch shows it.
      if (/already started/i.test(msg)) {
        setFile(null)
        toast('You are already on shift')
        return
      }
      setError(msg)
      toast.error(msg)
    }
  }

  const confirmEnd = async () => {
    try {
      await end.mutateAsync()
      toast.success('Shift ended')
    } catch (err) {
      toast.error(err?.message || 'Could not end your shift')
    }
  }

  if (shift.isLoading) {
    return (
      <section className="bg-surface border border-border rounded-2xl p-6" aria-busy="true">
        <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin mx-auto" />
      </section>
    )
  }

  if (shift.isError) {
    return (
      <section className="bg-surface border border-border rounded-2xl p-6">
        <p className="text-red-400 text-sm mb-3">Could not load your shift.</p>
        <button type="button" onClick={() => shift.refetch()} className="btn-outline min-h-11 px-4 text-xs uppercase tracking-widest">
          Try again
        </button>
      </section>
    )
  }

  const open = shift.data
  return (
    <section className="bg-surface border border-border rounded-2xl p-6" aria-labelledby="shift-heading">
      <h2 id="shift-heading" className="text-gold text-xs uppercase tracking-widest mb-3">Shift</h2>
      <p className="text-white font-semibold mb-4">{shiftStatusLabel(open, now)}</p>

      {open ? (
        <div className="space-y-4">
          {selfie.data && (
            <img src={selfie.data} alt="Your shift selfie" className="w-20 h-20 rounded-xl object-cover border border-border" />
          )}
          <button
            type="button"
            onClick={confirmEnd}
            disabled={end.isPending}
            className="btn-outline w-full min-h-11 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
          >
            <EndIcon size={16} aria-hidden="true" /> {end.isPending ? 'Ending…' : 'End shift'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={choose}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
          {preview ? (
            <>
              <img src={preview} alt="Your selfie" className="w-full max-h-80 rounded-xl object-cover border border-border" />
              <button type="button" onClick={confirmStart} disabled={start.isPending} className="btn-gold w-full min-h-11">
                {start.isPending ? 'Starting…' : 'Confirm & start shift'}
              </button>
              <button
                type="button"
                onClick={() => { setFile(null); setCameraOpen(true) }}
                disabled={start.isPending}
                className="btn-outline w-full min-h-11 text-xs uppercase tracking-widest"
              >
                Retake
              </button>
            </>
          ) : cameraOpen ? (
            // In-page camera: the phone's camera app can make Android close the browser ("low memory").
            <SelfieCamera
              onCapture={(photo) => { setCameraOpen(false); setError(''); setFile(photo) }}
              onCancel={() => setCameraOpen(false)}
              onFallback={() => { setCameraOpen(false); inputRef.current?.click() }}
            />
          ) : (
            <button
              type="button"
              onClick={() => { setError(''); setCameraOpen(true) }}
              className="btn-gold w-full min-h-11 inline-flex items-center justify-center gap-2"
            >
              <Camera size={18} aria-hidden="true" /> Start shift — take a selfie
            </button>
          )}
          {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}
        </div>
      )}
    </section>
  )
}
