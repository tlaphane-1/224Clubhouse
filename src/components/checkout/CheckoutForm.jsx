const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
]

export default function CheckoutForm({ form, onChange, errors, lockEmail = false }) {
  const set = (key, value) => onChange({ ...form, [key]: value })
  const inputCls = (key) => `input-base text-sm ${errors?.[key] ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`
  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Full Name *</label>
        <input className={inputCls('name')} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your full name" />
        {errors?.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Email Address *</label>
          <input
            type="email"
            className={`${inputCls('email')} ${lockEmail ? 'opacity-60 cursor-not-allowed' : ''}`}
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="you@email.com"
            disabled={lockEmail}
          />
          {lockEmail && <p className="text-muted text-xs mt-1">Orders are tied to your account email.</p>}
          {errors?.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
        </div>
        <div>
          <label className={labelCls}>Phone Number *</label>
          <input type="tel" className={inputCls('phone')} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="071 000 0000" />
          {errors?.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-widest">Shipping Address</h4>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Street Address *</label>
            <input className={inputCls('street')} value={form.street} onChange={e => set('street', e.target.value)} placeholder="123 Main Street" />
            {errors?.street && <p className="text-red-400 text-xs mt-1">{errors.street}</p>}
          </div>

          <div>
            <label className={labelCls}>Apartment / Suite (optional)</label>
            <input className={inputCls('apartment')} value={form.apartment} onChange={e => set('apartment', e.target.value)} placeholder="Apt 4B" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>City *</label>
              <input className={inputCls('city')} value={form.city} onChange={e => set('city', e.target.value)} placeholder="Boksburg" />
              {errors?.city && <p className="text-red-400 text-xs mt-1">{errors.city}</p>}
            </div>
            <div>
              <label className={labelCls}>Postal Code *</label>
              <input className={inputCls('postalCode')} value={form.postalCode} onChange={e => set('postalCode', e.target.value)} placeholder="1459" />
              {errors?.postalCode && <p className="text-red-400 text-xs mt-1">{errors.postalCode}</p>}
            </div>
          </div>

          <div>
            <label className={labelCls}>Province *</label>
            <select className={inputCls('province')} value={form.province} onChange={e => set('province', e.target.value)}>
              <option value="">Select province</option>
              {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {errors?.province && <p className="text-red-400 text-xs mt-1">{errors.province}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
