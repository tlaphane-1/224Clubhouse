import { PAYMENT_METHODS, PAYMENT_LABELS } from '../../utils/orderStatus'

const HELPER_TEXT = {
  cash_on_delivery: 'Pay with cash when your order arrives.',
  card_on_delivery: 'Pay by card machine at your door.',
}

export default function PaymentMethodSelect({ value, onChange }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="radiogroup" aria-label="Payment method">
      {PAYMENT_METHODS.map((m) => {
        const selected = value === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(m)}
            className={`text-left rounded-xl border p-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              selected
                ? 'border-gold ring-1 ring-gold bg-surface'
                : 'border-border bg-surface hover:border-gold/50'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selected ? 'border-gold' : 'border-border'
                }`}
              >
                {selected && <span className="w-2.5 h-2.5 rounded-full bg-gold" />}
              </span>
              <span className="font-semibold text-white">{PAYMENT_LABELS[m]}</span>
            </div>
            <p className="text-muted text-sm mt-2 ml-8">{HELPER_TEXT[m]}</p>
          </button>
        )
      })}
    </div>
  )
}
