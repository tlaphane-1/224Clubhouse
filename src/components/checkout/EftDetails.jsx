// Club's FNB business account (supplied by the owner 2026-10-01). Public by
// nature — customers need it to pay. VITE_EFT_BANK_DETAILS overrides it
// (use "\n" for new lines). Keep in step with the EFT_BANK_DETAILS function
// secret used by send-order-email.
const DEFAULT_BANK_DETAILS =
  'Bank: FNB\nAccount type: Gold Business Account\nAccount number: 63228491138\nBranch code: 250655'
const BANK_DETAILS = (import.meta.env.VITE_EFT_BANK_DETAILS || DEFAULT_BANK_DETAILS).replace(/\\n/g, '\n').trim()

export default function EftDetails({ reference, amountLabel }) {
  return (
    <div className="bg-gold/5 border border-gold/20 rounded-xl p-4 text-left">
      <p className="text-gold text-xs uppercase tracking-widest mb-2">Pay by EFT</p>
      {BANK_DETAILS ? (
        <p className="text-white text-sm whitespace-pre-line mb-2">{BANK_DETAILS}</p>
      ) : (
        <p className="text-white text-sm mb-2">We'll send you our banking details by email or WhatsApp.</p>
      )}
      <p className="text-muted text-xs leading-relaxed">
        {amountLabel && <>Amount: <span className="text-white">{amountLabel}</span>. </>}
        Use <span className="text-white font-semibold">{reference}</span> as your payment reference.
      </p>
    </div>
  )
}
