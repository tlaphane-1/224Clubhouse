import { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2 } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import EventForm from '../../components/admin/EventForm'
import { useAllEvents } from '../../hooks/useEvents'
import { supabase } from '../../lib/supabase'
import { formatZAR } from '../../utils/formatCurrency'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export default function AdminEvents() {
  const { data: events, isLoading } = useAllEvents()
  const [modalOpen, setModalOpen] = useState(false)
  const [editEvent, setEditEvent] = useState(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    document.title = 'Events | 224 Admin'
  }, [])

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this event?')) return
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
                  <th className="p-4 text-left font-medium">Event</th>
                  <th className="p-4 text-left font-medium">Date & Time</th>
                  <th className="p-4 text-center font-medium">Type</th>
                  <th className="p-4 text-right font-medium">Ticket</th>
                  <th className="p-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events?.map(event => (
                  <tr key={event.id} className="hover:bg-border/20 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
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
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(event)} className="text-muted hover:text-gold transition-colors p-1">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => handleDelete(event.id)} className="text-muted hover:text-red-400 transition-colors p-1">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
