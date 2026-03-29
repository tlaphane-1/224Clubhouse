import { PAYSTACK_PUBLIC_KEY } from '../../lib/paystack'
import { formatZAR } from '../../utils/formatCurrency'

export default function PaystackButton({ amount, email, name, phone, metadata, onSuccess, onClose, disabled }) {
  const handlePay = () => {
    if (disabled) return

    const reference = `224-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // @paystack/inline-js attaches PaystackPop to window
    const handler = window.PaystackPop?.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount,
      currency: 'ZAR',
      ref: reference,
      metadata: {
        custom_fields: [
          { display_name: 'Customer Name', variable_name: 'customer_name', value: name },
          { display_name: 'Phone', variable_name: 'phone', value: phone },
          ...(metadata?.custom_fields || []),
        ],
      },
      callback: (response) => onSuccess?.(response),
      onClose: () => onClose?.(),
    })

    handler?.openIframe()
  }

  return (
    <button
      type="button"
      onClick={handlePay}
      disabled={disabled}
      className="btn-gold w-full py-4 text-base disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Pay {formatZAR(amount)}
    </button>
  )
}
