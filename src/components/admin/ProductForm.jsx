import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../utils/slugify'
import { safeFileName } from '../../utils/safeFileName'
import { withTimeout } from '../../utils/withTimeout'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, X, Plus, Trash2 } from 'lucide-react'
import { sortedVariants } from '../../utils/variants'

const defaultForm = {
  name: '', description: '', price: '', category: 'flower',
  stock_quantity: '', is_available: true, is_member_only: false,
  strain_type: '', thc_percentage: '', weight_grams: '', images: [],
}

// Option rows are edited as strings (rands) and converted on save.
const toOptionRow = (v) => ({
  id: v.id, label: v.label, price: (v.price / 100).toFixed(2),
  stock_quantity: String(v.stock_quantity), is_available: v.is_available,
})
const blankOption = () => ({ id: null, label: '', price: '', stock_quantity: '0', is_available: true })

function validateOptions(options) {
  const labels = new Set()
  for (const o of options) {
    const label = o.label.trim()
    if (!label) return 'Every option needs a name (e.g. 3.5g)'
    if (labels.has(label.toLowerCase())) return `Option "${label}" is listed twice`
    labels.add(label.toLowerCase())
    if (!(parseFloat(o.price) >= 0)) return `Option "${label}" needs a price`
    if (!(parseInt(o.stock_quantity) >= 0)) return `Option "${label}" needs a stock quantity`
  }
  return null
}

export default function ProductForm({ product, onClose }) {
  const [form, setForm] = useState(product ? {
    ...product,
    price: (product.price / 100).toFixed(2),
  } : defaultForm)
  // Options (product_variants). While any exist, the product's price and stock
  // are derived by a database trigger (cheapest available option / total
  // stock), so those two fields lock below.
  const [options, setOptions] = useState(() => sortedVariants(product).map(toOptionRow))
  const removedOptionIds = useRef([])
  const hasOptions = options.length > 0
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleImageUpload = async (e) => {
    const input = e.target
    const files = Array.from(input.files)
    if (!files.length) return
    setUploading(true)
    try {
      const urls = await Promise.all(files.map(async (file, i) => {
        const path = `products/${Date.now()}-${i}-${safeFileName(file.name)}`
        const { error } = await withTimeout(
          supabase.storage.from('product-images').upload(path, file),
          60000, // uploads carry a file, so they get far longer than a plain write
          'image upload',
        )
        if (error) throw error
        const { data } = supabase.storage.from('product-images').getPublicUrl(path)
        return data.publicUrl
      }))
      // Functional update so repeated uploads accumulate (no stale closure on form.images).
      setForm(f => ({ ...f, images: [...(f.images || []), ...urls] }))
    } catch (err) {
      toast.error(err.message || 'Image upload failed')
    } finally {
      setUploading(false)
      input.value = '' // reset so selecting the same file again still fires onChange
    }
  }

  const removeImage = (url) => {
    set('images', form.images.filter(i => i !== url))
  }

  const setOption = (index, key, value) =>
    setOptions(rows => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  const removeOption = (index) => {
    const row = options[index]
    if (row.id) removedOptionIds.current.push(row.id)
    setOptions(rows => rows.filter((_, i) => i !== index))
  }

  // Writes the option rows after the product row exists. Deletes first so a
  // label freed by a removed row can be reused (labels are unique per product).
  const saveOptions = async (productId) => {
    if (removedOptionIds.current.length) {
      const { error } = await withTimeout(
        supabase.from('product_variants').delete().in('id', removedOptionIds.current), undefined, 'save options',
      )
      if (error) throw error
      removedOptionIds.current = []
    }
    for (const [index, o] of options.entries()) {
      const row = {
        product_id: productId,
        label: o.label.trim(),
        price: Math.round(parseFloat(o.price) * 100),
        stock_quantity: parseInt(o.stock_quantity),
        is_available: o.is_available,
        sort_order: index,
      }
      const { error } = await withTimeout(
        o.id
          ? supabase.from('product_variants').update(row).eq('id', o.id)
          : supabase.from('product_variants').insert(row),
        undefined, 'save options',
      )
      if (error) throw error
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const optionsError = hasOptions ? validateOptions(options) : null
    if (optionsError) {
      toast.error(optionsError)
      return
    }
    setSaving(true)
    try {
      // With options, the trigger owns price/stock. A NEW product still needs
      // starting values (price is NOT NULL); the first option write corrects them.
      const optionPrices = options.map(o => Math.round(parseFloat(o.price) * 100))
      const derived = hasOptions
        ? (product ? {} : {
            price: Math.min(...optionPrices),
            stock_quantity: options.reduce((n, o) => n + parseInt(o.stock_quantity), 0),
          })
        : {
            price: Math.round(parseFloat(form.price) * 100),
            stock_quantity: parseInt(form.stock_quantity),
          }
      const payload = {
        name: form.name,
        description: form.description,
        ...derived,
        category: form.category,
        is_available: form.is_available,
        is_member_only: form.is_member_only,
        images: form.images,
        strain_type: form.category === 'flower' ? form.strain_type || null : null,
        thc_percentage: form.category === 'flower' ? parseFloat(form.thc_percentage) || null : null,
        weight_grams: form.category === 'flower' ? parseFloat(form.weight_grams) || null : null,
        slug: product ? product.slug : slugify(form.name),
      }

      if (product) {
        const { error } = await withTimeout(
          supabase.from('products').update(payload).eq('id', product.id), undefined, 'save',
        )
        if (error) throw error
        await saveOptions(product.id)
        toast.success('Product updated')
      } else {
        const { data, error } = await withTimeout(
          supabase.from('products').insert(payload).select('id').single(), undefined, 'save',
        )
        if (error) throw error
        await saveOptions(data.id)
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

      {/* Price + Stock — derived from the options while there are any */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="product-price" className={labelCls}>Price (Rands) *</label>
          <input id="product-price" required={!hasOptions} disabled={hasOptions} type="number" min="0" step="0.01"
            className={`${inputCls} ${hasOptions ? 'opacity-60 cursor-not-allowed' : ''}`}
            value={hasOptions ? '' : form.price} onChange={e => set('price', e.target.value)}
            placeholder={hasOptions ? 'From options' : '50.00'} />
        </div>
        <div>
          <label htmlFor="product-stock" className={labelCls}>Stock Quantity *</label>
          <input id="product-stock" required={!hasOptions} disabled={hasOptions} type="number" min="0"
            className={`${inputCls} ${hasOptions ? 'opacity-60 cursor-not-allowed' : ''}`}
            value={hasOptions ? '' : form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)}
            placeholder={hasOptions ? 'From options' : '0'} />
        </div>
      </div>

      {/* Options (sizes / weights / flavours) */}
      <div className="p-4 bg-background rounded-lg border border-border">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="block text-muted text-xs uppercase tracking-widest">Options</span>
          <button type="button" onClick={() => setOptions(rows => [...rows, blankOption()])}
            className="focus-ring rounded-lg h-11 px-3 inline-flex items-center gap-1.5 text-gold text-xs uppercase tracking-widest hover:text-gold-light transition-colors">
            <Plus size={14} /> Add option
          </button>
        </div>
        <p className="text-muted text-xs mb-3">
          {hasOptions
            ? 'Customers must pick one. The store shows the cheapest available option; stock is the total.'
            : 'Optional — e.g. 1g, 3.5g, 7g, each with its own price and stock.'}
        </p>
        {hasOptions && (
          <div className="space-y-3">
            {options.map((o, i) => (
              <div key={o.id ?? `new-${i}`} className="grid grid-cols-2 sm:grid-cols-[1fr_7rem_6rem_auto_auto] items-end gap-2">
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor={`option-label-${i}`} className="block text-muted text-xs mb-1">Name</label>
                  <input id={`option-label-${i}`} className={inputCls} value={o.label} maxLength={60}
                    onChange={e => setOption(i, 'label', e.target.value)} placeholder="3.5g" />
                </div>
                <div>
                  <label htmlFor={`option-price-${i}`} className="block text-muted text-xs mb-1">Price (R)</label>
                  <input id={`option-price-${i}`} type="number" min="0" step="0.01" inputMode="decimal" className={inputCls}
                    value={o.price} onChange={e => setOption(i, 'price', e.target.value)} placeholder="120.00" />
                </div>
                <div>
                  <label htmlFor={`option-stock-${i}`} className="block text-muted text-xs mb-1">Stock</label>
                  <input id={`option-stock-${i}`} type="number" min="0" inputMode="numeric" className={inputCls}
                    value={o.stock_quantity} onChange={e => setOption(i, 'stock_quantity', e.target.value)} />
                </div>
                <div className="h-11 flex items-center">
                  <Checkbox id={`option-on-sale-${i}`} checked={o.is_available} onChange={v => setOption(i, 'is_available', v)}>
                    <span className="text-muted text-xs">On sale</span>
                  </Checkbox>
                </div>
                <button type="button" onClick={() => removeOption(i)} aria-label={`Remove option ${o.label || i + 1}`}
                  className="focus-ring rounded-lg w-11 h-11 flex items-center justify-center text-muted hover:text-red-400 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category */}
      <div>
        <label className={labelCls}>Category *</label>
        <select required className={inputCls} value={form.category} onChange={e => set('category', e.target.value)}>
          <option value="flower">Flower</option>
          <option value="edibles">Edibles</option>
          <option value="joints">Joints</option>
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
