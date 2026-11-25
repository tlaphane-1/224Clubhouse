import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Minus, Plus, QrCode, X } from 'lucide-react'
import toast from 'react-hot-toast'
import BrandLogo from '../../components/ui/BrandLogo'
import QrScanner from '../../components/counter/QrScanner'
import StaffUnlock from '../../components/counter/StaffUnlock'
import { StarPicker } from '../../components/store/StarRating'
import { useProducts } from '../../hooks/useProducts'
import { useTableIdentify, useSubmitTableRequest, useSubmitTableReview } from '../../hooks/useTable'
import { counterCartReducer, cartTotal, toSaleItems, productLine, pickerOptions, memberBadge } from '../../utils/counter'
import { parseMemberCode, idleMsFor, SENT_RESET_MS, canUseTableMode } from '../../utils/table'
import { useAuth } from '../../context/useAuth'
import { lockTable } from '../../utils/tableLock'
import { formatZAR } from '../../utils/formatCurrency'
import { lineName } from '../../utils/variants'
import { tenant, pageTitle } from '../../tenant'

// /table — the counter tablet as a customer menu. Anyone can browse; a
// customer scans their club card (QR on their phone) to see their orders,
// order (sent to the counter, paid and collected there) and rate products
// they've had. Resets after 3 minutes untouched. Staff need the password to leave.

const shortDate = (iso) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })

function RateCard({ item, token, onDone }) {
  const review = useSubmitTableReview()
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const submit = async () => {
    try {
      await review.mutateAsync({ token, productId: item.product_id, rating, body })
      toast.success('Thanks! Your rating will show once the club approves it.')
      onDone(item.product_id)
    } catch (err) {
      toast.error(err.message || 'Could not save your rating')
    }
  }
  return (
    <div className="border border-border rounded-xl p-4 space-y-3">
      <p className="text-white text-sm font-semibold">{item.name}</p>
      <StarPicker value={rating} onChange={setRating} name={`rate-${item.product_id}`} />
      <label className="block">
        <span className="block text-muted text-xs uppercase tracking-widest mb-1.5">Comment (optional)</span>
        <input className="input-base text-sm" maxLength={1000} value={body} onChange={e => setBody(e.target.value)} />
      </label>
      <button type="button" onClick={submit} disabled={!rating || review.isPending} className="btn-gold w-full min-h-11">
        {review.isPending ? 'Saving…' : 'Send rating'}
      </button>
    </div>
  )
}

export default function TableMode() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const allowed = canUseTableMode({ isAdmin })
  const { data: products, isLoading, isError, refetch } = useProducts()
  const identify = useTableIdentify()
  const submit = useSubmitTableRequest()
  const [guest, setGuest] = useState(null) // { token, ...table_identify result }
  const [cart, dispatch] = useReducer(counterCartReducer, { lines: [] })
  const [scanning, setScanning] = useState(false)
  const [category, setCategory] = useState('all')
  const [sent, setSent] = useState(false)
  const [rated, setRated] = useState([])
  const [exiting, setExiting] = useState(false)
  const idleRef = useRef(null)

  useEffect(() => {
    document.title = pageTitle('Menu')
    // Never lock an admin login into table mode: /admin would stay reachable.
    if (allowed) lockTable()
  }, [allowed])

  const reset = useCallback(() => {
    setGuest(null)
    dispatch({ type: 'clear' })
    setScanning(false)
    setSent(false)
    setRated([])
  }, [])

  // Back to the plain menu after a while without a touch: 1 minute while a
  // customer is shown (the next person may sit down), 3 minutes otherwise.
  const idleMs = idleMsFor(guest)
  useEffect(() => {
    const arm = () => {
      clearTimeout(idleRef.current)
      idleRef.current = setTimeout(reset, idleMs)
    }
    arm()
    window.addEventListener('pointerdown', arm)
    window.addEventListener('keydown', arm)
    return () => {
      clearTimeout(idleRef.current)
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [reset, idleMs])

  // After an order is sent, show the confirmation briefly, then clear the customer.
  useEffect(() => {
    if (!sent) return undefined
    const id = setTimeout(reset, SENT_RESET_MS)
    return () => clearTimeout(id)
  }, [sent, reset])

  const categories = useMemo(() => ['all', ...new Set((products ?? []).map(p => p.category))], [products])
  const shown = (products ?? []).filter(p => category === 'all' || p.category === category)

  const onScan = async (text) => {
    const token = parseMemberCode(text, tenant.domain.liveHosts)
    if (!token) {
      toast.error('That is not a club card')
      return
    }
    try {
      const data = await identify.mutateAsync(token)
      setGuest({ token, ...data })
      setScanning(false)
    } catch (err) {
      toast.error(/not recognised/i.test(err.message) ? 'Card not recognised. Ask at the counter.' : (err.message || 'Could not read the card'))
    }
  }

  const add = (line) => {
    if (!guest) {
      toast('Scan your club card to order', { icon: '📱' })
      setScanning(true)
      return
    }
    if (line.stock < 1) {
      toast.error('Sold out')
      return
    }
    dispatch({ type: 'add', line })
  }

  const orderAgain = (order) => {
    let added = 0
    for (const item of order.items ?? []) {
      const p = (products ?? []).find(x => x.id === item.id)
      if (!p) continue
      const v = item.variant_id ? (p.product_variants ?? []).find(x => x.id === item.variant_id && x.is_available) : null
      if (item.variant_id && !v) continue
      const line = productLine(p, v)
      for (let i = 0; i < item.quantity && line.stock > 0; i++) dispatch({ type: 'add', line })
      added++
    }
    if (added) toast.success('Added to your order')
    else toast.error('Those items are not available right now')
  }

  const send = async () => {
    try {
      await submit.mutateAsync({ token: guest.token, items: toSaleItems(cart.lines) })
      setSent(true)
      dispatch({ type: 'clear' })
    } catch (err) {
      toast.error(err.message || 'Could not send your order')
    }
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="max-w-md mx-auto bg-surface border border-border rounded-2xl p-6 text-center space-y-4">
          <h1 className="font-heading text-xl text-white">Use a staff account</h1>
          <p className="text-muted text-sm">
            Table mode puts the tablet in customers&apos; hands. Sign in with a staff account, not an admin account.
          </p>
          <button type="button" onClick={() => navigate('/counter')} className="btn-gold min-h-11 px-6">Back to the counter</button>
        </div>
      </div>
    )
  }

  if (exiting) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <StaffUnlock onUnlocked={() => navigate('/counter')} onCancel={() => setExiting(false)} />
      </div>
    )
  }

  const badge = guest ? memberBadge(guest.member_status) : null
  const reviewable = (guest?.reviewable ?? []).filter(r => !rated.includes(r.product_id))

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-12 w-auto" />
            <h1 className="font-heading text-2xl text-white uppercase tracking-widest">Menu</h1>
          </div>
          {guest ? (
            <button type="button" onClick={reset} className="btn-outline min-h-11 px-4 inline-flex items-center gap-2 text-xs uppercase tracking-widest">
              <X size={14} aria-hidden="true" /> Done
            </button>
          ) : (
            <button type="button" onClick={() => setScanning(s => !s)} className="btn-gold min-h-11 px-5 inline-flex items-center gap-2">
              <QrCode size={18} aria-hidden="true" /> Scan your club card
            </button>
          )}
        </header>

        {scanning && !guest && (
          <section className="bg-surface border border-border rounded-2xl p-6 max-w-md mx-auto space-y-3">
            <p className="text-white text-sm">Open <span className="text-gold">My Account</span> on your phone and hold your club card up to the camera.</p>
            <QrScanner facing="user" onCode={onScan} onClose={() => setScanning(false)} />
          </section>
        )}

        {sent && (
          <section className="bg-surface border border-green-500/20 rounded-2xl p-6 text-center" role="status">
            <p className="text-white font-semibold text-lg">Your order is at the counter</p>
            <p className="text-muted text-sm mt-1">Pay and collect it at the counter. Show your ID.</p>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Menu */}
          <section className="lg:col-span-2 space-y-4" aria-labelledby="menu-heading">
            <h2 id="menu-heading" className="sr-only">Menu</h2>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Categories">
              {categories.map(c => (
                <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
                  className={`focus-ring min-h-11 px-4 rounded-xl text-xs uppercase tracking-widest border ${category === c ? 'border-gold text-gold' : 'border-border text-muted hover:text-white'}`}>
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-32 skeleton rounded-2xl" />)}</div>
            ) : isError ? (
              <div className="bg-surface border border-red-500/20 rounded-2xl p-6">
                <p className="text-red-400 text-sm mb-3">Couldn&apos;t load the menu.</p>
                <button type="button" onClick={() => refetch()} className="btn-outline min-h-11 px-4 text-xs uppercase tracking-widest">Try again</button>
              </div>
            ) : shown.length === 0 ? (
              <p className="text-muted text-sm">Nothing here right now.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {shown.map(p => {
                  const { kind, variants } = pickerOptions(p)
                  return (
                    <article key={p.id} className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col">
                      {/* Same photo as the store's product card. */}
                      <div className="aspect-[4/3] bg-background overflow-hidden">
                        {p.images?.length > 0 ? (
                          <img src={p.images[0]} alt={p.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <BrandLogo decorative className="w-1/3 opacity-30" />
                          </div>
                        )}
                      </div>
                      <div className="p-5 space-y-3 flex-1 flex flex-col">
                      <div className="flex-1">
                        <h3 className="text-white font-semibold">{p.name}</h3>
                        <p className="text-muted text-xs mt-0.5">
                          {[p.strain_type, p.thc_percentage ? `THC ${p.thc_percentage}%` : null].filter(Boolean).join(' · ')}
                        </p>
                        {p.description && <p className="text-muted text-sm mt-2 line-clamp-2">{p.description}</p>}
                      </div>
                      {kind === 'unavailable' ? (
                        <p className="text-muted text-sm">Not available right now</p>
                      ) : kind === 'plain' ? (
                        <button type="button" disabled={p.stock_quantity < 1} onClick={() => add(productLine(p))}
                          className="btn-outline w-full min-h-11 text-sm disabled:opacity-50">
                          {p.stock_quantity < 1 ? 'Sold out' : `Add · ${formatZAR(p.price)}`}
                        </button>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {variants.map(v => (
                            <button key={v.id} type="button" disabled={v.stock_quantity < 1} onClick={() => add(productLine(p, v))}
                              className="focus-ring min-h-11 px-3 rounded-lg border border-border text-sm text-white hover:border-gold disabled:opacity-50">
                              {v.label} · {v.stock_quantity < 1 ? 'Sold out' : formatZAR(v.price)}
                            </button>
                          ))}
                        </div>
                      )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {/* The customer's side */}
          <aside className="space-y-6">
            {guest ? (
              <>
                <section className="bg-surface border border-border rounded-2xl p-6">
                  <p className="text-white font-semibold text-lg">Hi {guest.first_name}</p>
                  <p className="text-muted text-sm mt-1">{badge.label}</p>
                </section>

                <section className="bg-surface border border-border rounded-2xl p-6 space-y-4" aria-labelledby="your-order">
                  <h2 id="your-order" className="text-gold text-xs uppercase tracking-widest">Your order</h2>
                  {cart.lines.length === 0 ? (
                    <p className="text-muted text-sm">Tap Add on the menu, or order again below.</p>
                  ) : (
                    <>
                      <ul className="divide-y divide-border">
                        {cart.lines.map(l => (
                          <li key={l.key} className="py-2 flex items-center justify-between gap-2">
                            <span className="text-white text-sm min-w-0">{l.name}{l.label ? <span className="text-muted"> · {l.label}</span> : null}</span>
                            <span className="flex items-center gap-1 shrink-0">
                              <button type="button" aria-label={`One less ${l.name}`} onClick={() => dispatch({ type: 'setQty', key: l.key, quantity: l.quantity - 1 })}
                                className="focus-ring w-11 h-11 rounded-lg border border-border text-white inline-flex items-center justify-center"><Minus size={14} aria-hidden="true" /></button>
                              <span className="w-6 text-center text-white text-sm">{l.quantity}</span>
                              <button type="button" aria-label={`One more ${l.name}`} disabled={l.quantity >= l.stock} onClick={() => dispatch({ type: 'setQty', key: l.key, quantity: l.quantity + 1 })}
                                className="focus-ring w-11 h-11 rounded-lg border border-border text-white inline-flex items-center justify-center disabled:opacity-40"><Plus size={14} aria-hidden="true" /></button>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex justify-between pt-3 border-t border-border">
                        <span className="text-white font-semibold">Total</span>
                        <span className="text-gold font-bold">{formatZAR(cartTotal(cart.lines))}</span>
                      </div>
                      <button type="button" onClick={send} disabled={submit.isPending} className="btn-gold w-full min-h-11">
                        {submit.isPending ? 'Sending…' : 'Send order to the counter'}
                      </button>
                      <p className="text-muted text-xs">You pay and collect at the counter.</p>
                    </>
                  )}
                </section>

                <section className="bg-surface border border-border rounded-2xl p-6 space-y-3" aria-labelledby="last-orders">
                  <h2 id="last-orders" className="text-gold text-xs uppercase tracking-widest">Your last orders</h2>
                  {guest.orders.length === 0 ? (
                    <p className="text-muted text-sm">No orders yet.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {guest.orders.map(o => (
                        <li key={o.order_number} className="py-2">
                          <div className="flex justify-between gap-2 items-center">
                            <span className="text-white text-sm">{shortDate(o.created_at)}</span>
                            <button type="button" onClick={() => orderAgain(o)} className="focus-ring min-h-11 px-3 rounded-lg text-gold text-xs uppercase tracking-widest">
                              Order again
                            </button>
                          </div>
                          <p className="text-muted text-xs">{(o.items ?? []).map(i => `${i.quantity}× ${lineName(i)}`).join(', ')}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {reviewable.length > 0 && (
                  <section className="space-y-3" aria-labelledby="rate-heading">
                    <h2 id="rate-heading" className="text-gold text-xs uppercase tracking-widest">Rate what you&apos;ve had</h2>
                    {reviewable.slice(0, 3).map(r => (
                      <RateCard key={r.product_id} item={r} token={guest.token} onDone={id => setRated(x => [...x, id])} />
                    ))}
                  </section>
                )}
              </>
            ) : (
              <section className="bg-surface border border-border rounded-2xl p-6 space-y-2">
                <p className="text-white font-semibold">Want to order?</p>
                <p className="text-muted text-sm">Scan your club card from <span className="text-white">My Account</span> on your phone. No account? Order at the counter.</p>
              </section>
            )}
          </aside>
        </div>

        <footer className="flex justify-end">
          <button type="button" onClick={() => setExiting(true)}
            className="focus-ring rounded-lg min-h-11 px-3 inline-flex items-center gap-2 text-muted hover:text-white text-xs uppercase tracking-widest">
            <Lock size={14} aria-hidden="true" /> Staff
          </button>
        </footer>
      </div>
    </div>
  )
}
