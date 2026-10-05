import { Check } from 'lucide-react'

// A real checkbox (keyboard, screen readers and form semantics all work) drawn
// as the brand's gold box. The whole label row is the tap target. Links inside
// `children` still work as links.
export default function Checkbox({ id, checked, onChange, invalid = false, children }) {
  return (
    <label htmlFor={id} className="relative flex items-start gap-3 cursor-pointer py-1">
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
      />
      <span
        aria-hidden="true"
        className={`flex-shrink-0 w-6 h-6 mt-0.5 rounded-md border-2 flex items-center justify-center transition-colors
                    peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-focus-visible:ring-offset-2
                    peer-focus-visible:ring-offset-surface ${
                      checked ? 'bg-gold border-gold' : invalid ? 'border-red-500' : 'border-muted/60'
                    }`}
      >
        {checked && <Check size={16} strokeWidth={3} className="text-black" />}
      </span>
      <span className="text-sm leading-relaxed">{children}</span>
    </label>
  )
}
