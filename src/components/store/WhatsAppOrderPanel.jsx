import { useRef, useState } from 'react'
import { useCart } from '../../context/CartContext'
import { buildWhatsAppLink, composeOrderMessage } from '../../utils/whatsappOrder'

// Digits only, international format without + (e.g. 27821234567).
// Read here at the component level, never inside the pure utils.
const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER

/** WhatsApp glyph, inline so no external asset is needed. */
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4 flex-shrink-0">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 18.15h-.01c-1.52 0-3.02-.41-4.32-1.18l-.31-.18-3.21.84.86-3.13-.2-.32a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.23 8.23" />
    </svg>
  )
}

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
  const [mode, setMode] = useState('collection')
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

  const modeButton = (active) =>
    active
      ? 'flex-1 py-2 rounded-lg border border-gold bg-gold/10 text-gold text-sm font-semibold transition-colors'
      : 'flex-1 py-2 rounded-lg border border-border text-muted hover:text-white text-sm transition-colors'

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h3 className="font-heading text-lg font-semibold text-white mb-1">Or order on WhatsApp</h3>
      <p className="text-muted text-xs mb-5">
        We take orders on WhatsApp every day — send your cart straight to the store.
      </p>

      <div className="flex gap-2 mb-4" role="group" aria-label="Collection or delivery">
        <button
          type="button"
          className={modeButton(mode === 'collection')}
          aria-pressed={mode === 'collection'}
          onClick={() => setMode('collection')}
        >
          Collection
        </button>
        <button
          type="button"
          className={modeButton(mode === 'delivery')}
          aria-pressed={mode === 'delivery'}
          onClick={() => setMode('delivery')}
        >
          Delivery
        </button>
      </div>

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
