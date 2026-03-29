import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../utils/slugify'
import Button from '../ui/Button'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, X } from 'lucide-react'

const defaultForm = {
  name: '', description: '', price: '', category: 'flower',
  stock_quantity: '', is_available: true, is_member_only: false,
  strain_type: '', thc_percentage: '', weight_grams: '', images: [],
}

export default function ProductForm({ product, onClose }) {
  const [form, setForm] = useState(product ? {
    ...product,
    price: (product.price / 100).toFixed(2),
  } : defaultForm)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    try {
      const urls = await Promise.all(files.map(async (file) => {
        const path = `products/${Date.now()}-${file.name}`
        const { error } = await supabase.storage.from('product-images').upload(path, file)
        if (error) throw error
        const { data } = supabase.storage.from('product-images').getPublicUrl(path)
        return data.publicUrl
      }))
      set('images', [...(form.images || []), ...urls])
    } catch (err) {
      toast.error('Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  const removeImage = (url) => {
    set('images', form.images.filter(i => i !== url))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        description: form.description,
        price: Math.round(parseFloat(form.price) * 100),
        category: form.category,
        stock_quantity: parseInt(form.stock_quantity),
        is_available: form.is_available,
        is_member_only: form.is_member_only,
        images: form.images,
        strain_type: form.category === 'flower' ? form.strain_type || null : null,
        thc_percentage: form.category === 'flower' ? parseFloat(form.thc_percentage) || null : null,
        weight_grams: form.category === 'flower' ? parseFloat(form.weight_grams) || null : null,
        slug: product ? product.slug : slugify(form.name),
      }

      if (product) {
        const { error } = await supabase.from('products').update(payload).eq('id', product.id)
        if (error) throw error
        toast.success('Product updated')
      } else {
        const { error } = await supabase.from('products').insert(payload)
        if (error) throw error
        toast.success('Product created')
      }

      queryClient.invalidateQueries({ queryKey: ['products'] })
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
      {/* Name */}
      <div>
        <label className={labelCls}>Product Name *</label>
        <input required className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. OG Kush" />
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <textarea rows={3} className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the product..." />
      </div>

      {/* Price + Stock */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Price (Rands) *</label>
          <input required type="number" min="0" step="0.01" className={inputCls} value={form.price} onChange={e => set('price', e.target.value)} placeholder="50.00" />
        </div>
        <div>
          <label className={labelCls}>Stock Quantity *</label>
          <input required type="number" min="0" className={inputCls} value={form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)} placeholder="0" />
        </div>
      </div>

      {/* Category */}
      <div>
        <label className={labelCls}>Category *</label>
        <select required className={inputCls} value={form.category} onChange={e => set('category', e.target.value)}>
          <option value="flower">Flower</option>
          <option value="edibles">Edibles</option>
          <option value="accessories">Accessories</option>
          <option value="merchandise">Merchandise</option>
        </select>
      </div>

      {/* Flower-specific */}
      {form.category === 'flower' && (
        <div className="grid grid-cols-3 gap-4 p-4 bg-background rounded-lg border border-border">
          <div>
            <label className={labelCls}>Strain Type</label>
            <select className={inputCls} value={form.strain_type} onChange={e => set('strain_type', e.target.value)}>
              <option value="">Select</option>
              <option value="indica">Indica</option>
              <option value="sativa">Sativa</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>THC %</label>
            <input type="number" min="0" max="100" step="0.1" className={inputCls} value={form.thc_percentage} onChange={e => set('thc_percentage', e.target.value)} placeholder="25.0" />
          </div>
          <div>
            <label className={labelCls}>Weight (g)</label>
            <input type="number" min="0" step="0.1" className={inputCls} value={form.weight_grams} onChange={e => set('weight_grams', e.target.value)} placeholder="3.5" />
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className="flex gap-6">
        {[
          { key: 'is_available', label: 'Available' },
          { key: 'is_member_only', label: 'Members Only' },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => set(key, !form[key])}
              className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${form[key] ? 'bg-gold' : 'bg-border'} relative`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${form[key] ? 'left-5' : 'left-1'}`} />
            </div>
            <span className="text-muted text-sm">{label}</span>
          </label>
        ))}
      </div>

      {/* Images */}
      <div>
        <label className={labelCls}>Images</label>
        <div className="flex flex-wrap gap-3 mb-3">
          {form.images?.map(url => (
            <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button type="button" onClick={() => removeImage(url)}
                className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 text-white hover:bg-red-600 transition-colors">
                <X size={10} />
              </button>
            </div>
          ))}
          <label className="w-20 h-20 border border-dashed border-border rounded-lg flex items-center justify-center cursor-pointer hover:border-gold transition-colors">
            <Upload size={20} className="text-muted" />
            <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
          </label>
        </div>
        {uploading && <p className="text-muted text-xs">Uploading...</p>}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : product ? 'Update Product' : 'Add Product'}</Button>
      </div>
    </form>
  )
}
