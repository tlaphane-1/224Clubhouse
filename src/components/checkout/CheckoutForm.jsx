import { checkoutFieldId } from './checkoutFields'

const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
]


export default function CheckoutForm({ form, onChange, errors, lockEmail = false }) {
  const set = (key, value) => onChange({ ...form, [key]: value })
  const inputCls = (key) => `input-base text-sm ${errors?.[key] ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`
  const labelCls = 'block text-muted text-xs uppercase tracking-widest mb-1.5'

  // Shared wiring for a field: label link, error announcement.
  const field = (key) => ({
    id: checkoutFieldId(key),
    'aria-invalid': errors?.[key] ? true : undefined,
    'aria-describedby': errors?.[key] ? `${checkoutFieldId(key)}-error` : undefined,
  })
  const errorText = (key) => errors?.[key] && (
    <p id={`${checkoutFieldId(key)}-error`} className="text-red-400 text-xs mt-1">{errors[key]}</p>
  )

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={checkoutFieldId('name')} className={labelCls}>Full Name *</label>
        <input {...field('name')} className={inputCls('name')} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your full name" autoComplete="name" />
        {errorText('name')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={checkoutFieldId('email')} className={labelCls}>Email Address *</label>
          <input
            {...field('email')}
            type="email"
            className={`${inputCls('email')} ${lockEmail ? 'opacity-60 cursor-not-allowed' : ''}`}
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            disabled={lockEmail}
          />
          {lockEmail && <p className="text-muted text-xs mt-1">Orders are tied to your account email.</p>}
          {errorText('email')}
        </div>
        <div>
          <label htmlFor={checkoutFieldId('phone')} className={labelCls}>Phone Number *</label>
          <input {...field('phone')} type="tel" inputMode="tel" className={inputCls('phone')} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="071 000 0000" autoComplete="tel" />
          {errorText('phone')}
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-widest">Delivery Address</h3>

        <div className="space-y-4">
          <div>
            <label htmlFor={checkoutFieldId('street')} className={labelCls}>Street Address *</label>
            <input {...field('street')} className={inputCls('street')} value={form.street} onChange={e => set('street', e.target.value)} placeholder="123 Main Street" autoComplete="address-line1" />
            {errorText('street')}
          </div>

          <div>
            <label htmlFor={checkoutFieldId('apartment')} className={labelCls}>Apartment / Suite (optional)</label>
            <input {...field('apartment')} className={inputCls('apartment')} value={form.apartment} onChange={e => set('apartment', e.target.value)} placeholder="Apt 4B" autoComplete="address-line2" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={checkoutFieldId('city')} className={labelCls}>City *</label>
              <input {...field('city')} className={inputCls('city')} value={form.city} onChange={e => set('city', e.target.value)} placeholder="Boksburg" autoComplete="address-level2" />
              {errorText('city')}
            </div>
            <div>
              <label htmlFor={checkoutFieldId('postalCode')} className={labelCls}>Postal Code *</label>
              <input {...field('postalCode')} inputMode="numeric" className={inputCls('postalCode')} value={form.postalCode} onChange={e => set('postalCode', e.target.value)} placeholder="1459" autoComplete="postal-code" maxLength={4} />
              {errorText('postalCode')}
            </div>
          </div>

          <div>
            <label htmlFor={checkoutFieldId('province')} className={labelCls}>Province *</label>
            <select {...field('province')} className={inputCls('province')} value={form.province} onChange={e => set('province', e.target.value)} autoComplete="address-level1">
              <option value="">Select province</option>
              {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {errorText('province')}
          </div>
        </div>
      </div>
    </div>
  )
}
