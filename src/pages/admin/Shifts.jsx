import { useEffect, useMemo, useState } from 'react'
import { Clock, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import { useShiftsForDay, useSelfieUrl } from '../../hooks/useShifts'
import { formatSastTime, shiftDuration, sortShifts, todaySast } from '../../utils/shifts'
import { adminTitle } from '../../tenant'

// Admin → Shifts: who clocked in on a day, when, for how long, with the
// selfie they took. Selfies are private; links last 10 minutes.

function Selfie({ path, name, onOpen }) {
  const { data: url, isLoading } = useSelfieUrl(path)
  if (isLoading) return <div className="w-16 h-16 rounded-xl skeleton" aria-hidden="true" />
  if (!url) return <div className="w-16 h-16 rounded-xl border border-border" aria-label="Selfie unavailable" />
  return (
    <button type="button" onClick={() => onOpen(url)} className="focus-ring rounded-xl shrink-0" aria-label={`Open ${name}'s selfie`}>
      <img src={url} alt="" className="w-16 h-16 rounded-xl object-cover border border-border" />
    </button>
  )
}

export default function AdminShifts() {
  const [day, setDay] = useState(() => todaySast())
  const [openUrl, setOpenUrl] = useState(null)
  const { data, isLoading, isError, refetch } = useShiftsForDay(day)
  const shifts = useMemo(() => sortShifts(data ?? []), [data])

  useEffect(() => {
    document.title = adminTitle('Shifts')
  }, [])

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-8">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Shifts</h1>
          <p className="text-muted text-sm mt-1">Clock-ins from the counter tablet, with the selfie taken at the start.</p>
        </div>
        <div>
          <label htmlFor="shift-day" className="block text-muted text-xs uppercase tracking-widest mb-1.5">Day</label>
          <input id="shift-day" type="date" className="input-base text-sm min-h-11" value={day} max={todaySast()}
            onChange={(e) => e.target.value && setDay(e.target.value)} />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" /></div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">Couldn&apos;t load shifts.</p>
            <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
          </div>
        ) : shifts.length === 0 ? (
          <div className="p-8 text-center">
            <Clock size={28} className="text-muted mx-auto mb-3" />
            <p className="text-white text-sm">No shifts on this day.</p>
          </div>
        ) : (
          shifts.map(s => (
            <div key={s.id} className="border-b border-border/50 last:border-0 px-4 sm:px-5 py-4 flex items-center gap-4">
              <Selfie path={s.selfie_path} name={s.full_name} onOpen={setOpenUrl} />
              <div className="min-w-0 flex-1">
                <p className="text-white font-medium text-sm">{s.full_name}</p>
                <p className="text-muted text-xs mt-0.5">
                  {formatSastTime(s.started_at)} – {s.ended_at ? formatSastTime(s.ended_at) : 'now'} · {shiftDuration(s.started_at, s.ended_at)}
                </p>
              </div>
              {!s.ended_at && (
                <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Still on shift</span>
              )}
            </div>
          ))
        )}
      </div>

      <Modal isOpen={!!openUrl} onClose={() => setOpenUrl(null)} title="Shift selfie" size="sm">
        {openUrl && <img src={openUrl} alt="Shift selfie" className="w-full rounded-xl" />}
      </Modal>
    </AdminLayout>
  )
}
