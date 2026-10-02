import { useEffect, useState } from 'react'
import {
  Plus, Edit2, Trash2, AlertTriangle, ChevronDown, ChevronRight, Download, Users, Check, X,
} from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import EventForm from '../../components/admin/EventForm'
import { useAllEvents, useUpdateEventCapacity } from '../../hooks/useEvents'
import {
  useEventReservations, useUpdateReservationStatus,
} from '../../hooks/useEventReservations'
import { supabase } from '../../lib/supabase'
import { formatZAR } from '../../utils/formatCurrency'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

// Reservation statuses reuse the existing Badge palette rather than adding
// variants: reserved reads as "booked" (blue), attended as done (green).
const STATUS_VARIANT = { reserved: 'confirmed', attended: 'delivered', cancelled: 'cancelled' }

// RFC 4180-style escaping, same helper as the newsletter export.
function csvField(value) {
  const v = value == null ? '' : String(value)
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function exportDoorList(event, reservations) {
  const header = 'name,email,phone,spots,status,due_at_door_rands,reserved_at'
  const rows = reservations.map(r =>
    [
      r.name, r.email, r.phone, r.quantity, r.status,
      ((r.total_cents ?? 0) / 100).toFixed(2), r.created_at,
    ].map(csvField).join(','),
  )
  const csv = [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `door-list-${event.date}-${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function DoorList({ event }) {
  const { data: reservations, isLoading, isError, refetch } = useEventReservations(event.id)
  const updateStatus = useUpdateReservationStatus()
  const updateCapacity = useUpdateEventCapacity()
  const [capacityInput, setCapacityInput] = useState(
    event.capacity == null ? '' : String(event.capacity),
  )

  const rows = reservations ?? []
  // Cancelled guests are kept visible (they may still turn up and argue) but
  // they don't count towards the headcount the door is expecting.
  const live = rows.filter(r => r.status !== 'cancelled')
  const headcount = live.reduce((sum, r) => sum + (r.quantity ?? 0), 0)
  const attended = rows
    .filter(r => r.status === 'attended')
    .reduce((sum, r) => sum + (r.quantity ?? 0), 0)
  const dueAtDoor = live.reduce((sum, r) => sum + (r.total_cents ?? 0), 0)

  const setStatus = async (id, status) => {
    try {
      await updateStatus.mutateAsync({ id, status })
      toast.success(status === 'attended' ? 'Checked in' : 'Reservation cancelled')
    } catch (err) {
      toast.error(err?.message || 'Update failed')
    }
  }

  const saveCapacity = async () => {
    const trimmed = capacityInput.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      toast.error('Capacity must be a whole number of 1 or more (blank = unlimited)')
      return
    }
    try {
      await updateCapacity.mutateAsync({ id: event.id, capacity: value })
      toast.success(value === null ? 'Capacity cleared — unlimited' : `Capacity set to ${value}`)
    } catch (err) {
      toast.error(err?.message || 'Could not save capacity')
    }
  }

  return (
    <div className="bg-background/60 border-t border-border p-5">
      {/* Summary + controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Expected headcount</p>
            <p className="font-heading text-2xl font-bold text-white">
              {headcount}
              {event.capacity != null && <span className="text-muted text-base"> / {event.capacity}</span>}
            </p>
          </div>
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Checked in</p>
            <p className="font-heading text-2xl font-bold text-white">{attended}</p>
          </div>
          <div>
            <p className="text-muted text-xs uppercase tracking-widest mb-1">Due at the door</p>
            <p className="font-heading text-2xl font-bold text-gold">{formatZAR(dueAtDoor)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-muted text-xs uppercase tracking-widest mb-1.5">
              Capacity (blank = unlimited)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                step="1"
                className="input-base text-sm w-32"
                value={capacityInput}
                onChange={e => setCapacityInput(e.target.value)}
                placeholder="Unlimited"
              />
              <button
                onClick={saveCapacity}
                disabled={updateCapacity.isPending}
                className="btn-outline text-sm px-4 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
          <button
            onClick={() => exportDoorList(event, rows)}
            disabled={rows.length === 0}
            className="btn-gold text-sm inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} /> Export door list
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted text-sm py-4">Loading reservations...</p>
      ) : isError ? (
        <div className="py-4">
          <p className="text-white text-sm mb-3">Couldn&apos;t load reservations.</p>
          <button onClick={() => refetch()} className="btn-outline text-sm">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted text-sm py-4">No reservations yet.</p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
                <th className="p-3 text-left font-medium">Guest</th>
                <th className="p-3 text-left font-medium">Contact</th>
                <th className="p-3 text-center font-medium">Spots</th>
                <th className="p-3 text-right font-medium">Due</th>
                <th className="p-3 text-center font-medium">Status</th>
                <th className="p-3 text-right font-medium">Door</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50' : ''}>
                  <td className="p-3 text-white font-medium">{r.name}</td>
                  <td className="p-3">
                    <p className="text-white">{r.email}</p>
                    <p className="text-muted text-xs">{r.phone}</p>
                  </td>
                  <td className="p-3 text-center text-white">{r.quantity}</td>
                  <td className="p-3 text-right text-white">{formatZAR(r.total_cents ?? 0)}</td>
                  <td className="p-3 text-center">
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'pending'}>{r.status}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">
                      {r.status !== 'attended' && (
                        <button
                          onClick={() => setStatus(r.id, 'attended')}
                          disabled={updateStatus.isPending}
                          className="text-muted hover:text-green-400 transition-colors p-1 disabled:opacity-40"
                          title="Mark attended"
                        >
                          <Check size={16} />
                        </button>
                      )}
                      {r.status !== 'cancelled' && (
                        <button
                          onClick={() => setStatus(r.id, 'cancelled')}
                          disabled={updateStatus.isPending}
                          className="text-muted hover:text-red-400 transition-colors p-1 disabled:opacity-40"
                          title="Cancel reservation"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AdminEvents() {
  const { data: events, isLoading, isError, refetch } = useAllEvents()
  const [modalOpen, setModalOpen] = useState(false)
  const [editEvent, setEditEvent] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    document.title = 'Events | 224 Admin'
  }, [])

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this event? Its reservations are deleted with it.')) return
    try {
      const { error } = await supabase.from('events').delete().eq('id', id)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event deleted')
    } catch {
      toast.error('Delete failed')
    }
  }

  const openAdd = () => { setEditEvent(null); setModalOpen(true) }
  const openEdit = (event) => { setEditEvent(event); setModalOpen(true) }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Events</h1>
          <p className="text-muted text-sm mt-1">{events?.length || 0} total events</p>
        </div>
        <button onClick={openAdd} className="btn-gold flex items-center gap-2 text-sm">
          <Plus size={16} /> Add Event
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading...</div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load events. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
                  <th className="p-4 text-left font-medium">Event</th>
                  <th className="p-4 text-left font-medium">Date & Time</th>
                  <th className="p-4 text-center font-medium">Type</th>
                  <th className="p-4 text-right font-medium">Ticket</th>
                  <th className="p-4 text-center font-medium">Spots left</th>
                  <th className="p-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events?.map(event => {
                  const expanded = expandedId === event.id
                  return [
                    <tr key={event.id} className="hover:bg-border/20 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setExpandedId(expanded ? null : event.id)}
                            className="text-muted hover:text-gold transition-colors p-1"
                            aria-label={expanded ? 'Hide door list' : 'Show door list'}
                          >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          {event.image_url && (
                            <img src={event.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          )}
                          <span className="text-white font-medium">{event.title}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-white">{new Date(event.date + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        {event.time && <p className="text-muted text-xs">{event.time}</p>}
                      </td>
                      <td className="p-4 text-center">
                        {event.is_members_only ? <Badge variant="members">Members Only</Badge> : <span className="text-muted text-xs">Public</span>}
                      </td>
                      <td className="p-4 text-right text-white">
                        {event.ticket_price ? formatZAR(event.ticket_price) : <span className="text-muted">Free</span>}
                      </td>
                      <td className="p-4 text-center text-white">
                        {event.seats_remaining == null
                          ? <span className="text-muted text-xs">Unlimited</span>
                          : event.seats_remaining}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setExpandedId(expanded ? null : event.id)}
                            className="text-muted hover:text-gold transition-colors p-1"
                            title="Door list"
                          >
                            <Users size={16} />
                          </button>
                          <button onClick={() => openEdit(event)} className="text-muted hover:text-gold transition-colors p-1">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => handleDelete(event.id)} className="text-muted hover:text-red-400 transition-colors p-1">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={`${event.id}-door`}>
                        <td colSpan={6} className="p-0">
                          <DoorList event={event} />
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editEvent ? 'Edit Event' : 'Add Event'}
      >
        <EventForm event={editEvent} onClose={() => setModalOpen(false)} />
      </Modal>
    </AdminLayout>
  )
}
