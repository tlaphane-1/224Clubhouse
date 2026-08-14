import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { safeFileName } from '../../utils/safeFileName'
import { withTimeout } from '../../utils/withTimeout'

const DEFAULT_LOCATION = '224 Rondebult Ave, Libradene, Boksburg'

const defaultForm = {
  title: '', description: '', date: '', time: '',
  location: DEFAULT_LOCATION, image_url: '',
  is_members_only: false, ticket_price: '',
}

export default function EventForm({ event, onClose }) {
  const [form, setForm] = useState(event ? {
    ...event,
    ticket_price: event.ticket_price ? (event.ticket_price / 100).toFixed(2) : '',
  } : defaultForm)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleImageUpload = async (e) => {
    const input = e.target
    const file = input.files[0]
    if (!file) return
    setUploading(true)
    try {
      const path = `events/${Date.now()}-${safeFileName(file.name)}`
      const { error } = await withTimeout(
        supabase.storage.from('event-images').upload(path, file),
        60000, // uploads carry a file, so they get far longer than a plain write
        'image upload',
      )
      if (error) throw error
      const { data } = supabase.storage.from('event-images').getPublicUrl(path)
      set('image_url', data.publicUrl)
    } catch (err) {
      toast.error(err.message || 'Image upload failed')
    } finally {
      setUploading(false)
      input.value = '' // reset so selecting the same file again still fires onChange
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        description: form.description,
        date: form.date,
        time: form.time,
        location: form.location,
        image_url: form.image_url || null,
        is_members_only: form.is_members_only,
        ticket_price: form.ticket_price ? Math.round(parseFloat(form.ticket_price) * 100) : null,
      }

      if (event) {
        const { error } = await withTimeout(
          supabase.from('events').update(payload).eq('id', event.id), undefined, 'save',
        )
        if (error) throw error
        toast.success('Event updated')
      } else {
        const { error } = await withTimeout(
          supabase.from('events').insert(payload), undefined, 'save',
        )
        if (error) throw error
        toast.success('Event created')
      }

      queryClient.invalidateQueries({ queryKey: ['events'] })
      onClose()
    } catch (err) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'input-base text-sm'
  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={labelCls}>Event Title *</label>
        <input required className={inputCls} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Sesh Sunday" />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea rows={3} className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Date *</label>
          <input required type="date" className={inputCls} value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Time</label>
          <input type="time" className={inputCls} value={form.time} onChange={e => set('time', e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Location</label>
        <input className={inputCls} value={form.location} onChange={e => set('location', e.target.value)} />
      </div>

      <div>
        <label className={labelCls}>Ticket Price (Rands, optional)</label>
        <input type="number" min="0" step="0.01" className={inputCls} value={form.ticket_price} onChange={e => set('ticket_price', e.target.value)} placeholder="Free if empty" />
      </div>

      {/* Image */}
      <div>
        <label className={labelCls}>Event Image</label>
        {form.image_url && (
          <img src={form.image_url} alt="" className="w-full h-32 object-cover rounded-lg mb-3 border border-border" />
        )}
        <label className="flex items-center gap-2 cursor-pointer text-muted hover:text-gold transition-colors text-sm">
          <Upload size={16} />
          {uploading ? 'Uploading...' : 'Upload Image'}
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
        </label>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <div onClick={() => set('is_members_only', !form.is_members_only)}
          className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${form.is_members_only ? 'bg-gold' : 'bg-border'} relative`}>
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form.is_members_only ? 'left-5' : 'left-1'}`} />
        </div>
        <span className="text-muted text-sm">Members Only Event</span>
      </label>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : event ? 'Update Event' : 'Add Event'}</Button>
      </div>
    </form>
  )
}
