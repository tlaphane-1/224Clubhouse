export default function Button({ variant = 'gold', children, className = '', disabled, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

  const variants = {
    gold: 'bg-gold hover:bg-gold-light text-black px-6 py-3 rounded-lg hover:shadow-lg hover:shadow-gold/30',
    outline: 'border border-gold text-gold hover:bg-gold hover:text-black px-6 py-3 rounded-lg',
    ghost: 'text-muted hover:text-white px-4 py-2 rounded-lg',
    danger: 'bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-lg',
  }

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
