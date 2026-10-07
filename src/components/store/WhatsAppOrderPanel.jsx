import { useRef, useState } from 'react'
import { useCart } from '../../context/useCart'
import { buildWhatsAppLink, composeOrderMessage } from '../../utils/whatsappOrder'
import { WhatsAppIcon } from '../ui/WhatsAppButton'

// Digits only, international format without + (e.g. 27821234567).
// Read here at the component level, never inside the pure utils.
const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER

const SEND_CLASSES =
  'inline-flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-green-500 ' +
  'text-green-400 hover:bg-green-500 hover:text-black font-semibold text-sm ' +
  'transition-all duration-200 active:scale-95'

/**
 * "Or order on WhatsApp" — the store's original order channel, offered on
 * the Cart page as a first-class alternative to the account-required COD
 * checkout (which stays visually primary).
 *
 * The send control is a real <a href="https://wa.me/..."> rather than a
 * button that navigates: WhatsApp deep links behave best as plain anchors,
 * especially inside in-app browsers. Validation (delivery needs an
 * address) therefore happens in onClick by preventing the navigation.
 *
 * Sending does NOT clear the cart — the store might not answer, and a
 * customer returning to retry should find their order intact.
 */
export default function WhatsAppOrderPanel() {
  const { items } = useCart()
  const addressRef = useRef(null)
  // Store closed until further notice — delivery only (2026-10-01).
  const mode = 'delivery'
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const configured = Boolean(String(WHATSAPP_NUMBER ?? '').trim())
  const needsAddress = mode === 'delivery' && !address.trim()

  // Unconfigured in production: the panel simply doesn't exist for customers.
  // In dev it stays visible (disabled, with a note) so the gap is obvious.
  if (!configured && !import.meta.env.DEV) return null

  const message = composeOrderMessage({
    items,
    mode,
    name: name.trim(),
    address: address.trim(),
    note: note.trim(),
  })

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h3 className="font-heading text-lg font-semibold text-white mb-1">Or order on WhatsApp</h3>
      <p className="text-muted text-xs mb-5">
        We take orders on WhatsApp every day — send your cart straight to the store.
      </p>

      <div className="space-y-3 mb-5">
        <div>
          <label className="block text-muted text-xs mb-1" htmlFor="wa-name">
            Your name (optional)
          </label>
          <input
            id="wa-name"
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>

        {mode === 'delivery' && (
          <div>
            <label className="block text-muted text-xs mb-1" htmlFor="wa-address">
              Delivery address
            </label>
            <textarea
              id="wa-address"
              className="input-base resize-none"
              rows={2}
              ref={addressRef}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
              required
            />
            {showErrors && needsAddress && (
              <p className="text-red-400 text-xs mt-1" role="alert">
                We need an address to deliver to.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-muted text-xs mb-1" htmlFor="wa-note">
            Note (optional)
          </label>
          <input
            id="wa-note"
            className="input-base"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. call when you arrive"
          />
        </div>
      </div>

      {configured ? (
        <a
          className={SEND_CLASSES}
          href={buildWhatsAppLink(WHATSAPP_NUMBER, message)}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={needsAddress}
          onClick={(e) => {
            if (needsAddress) {
              e.preventDefault()
              setShowErrors(true)
              addressRef.current?.focus()
            }
          }}
        >
          <WhatsAppIcon />
          Send order on WhatsApp
        </a>
      ) : (
        <>
          <span className={`${SEND_CLASSES} opacity-50 cursor-not-allowed`} aria-disabled="true">
            <WhatsAppIcon />
            Send order on WhatsApp
          </span>
          <p className="text-muted text-xs mt-2">WhatsApp ordering is not configured yet.</p>
        </>
      )}

      <p className="text-muted text-xs mt-3">
        We reply on WhatsApp to confirm your order. Your cart stays as it is until you clear it.
      </p>
    </div>
  )
}
