import { BANK_DETAILS } from '../../utils/bankDetails'

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
