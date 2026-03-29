const variants = {
  flower: 'bg-green-900/50 text-green-400 border border-green-800',
  edibles: 'bg-orange-900/50 text-orange-400 border border-orange-800',
  accessories: 'bg-blue-900/50 text-blue-400 border border-blue-800',
  merchandise: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800',
  indica: 'bg-purple-900/50 text-purple-300 border border-purple-800',
  sativa: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  hybrid: 'bg-teal-900/50 text-teal-300 border border-teal-800',
  members: 'bg-gold/20 text-gold border border-gold/40',
  pending: 'bg-yellow-900/40 text-yellow-400',
  paid: 'bg-green-900/40 text-green-400',
  processing: 'bg-blue-900/40 text-blue-400',
  shipped: 'bg-purple-900/40 text-purple-400',
  delivered: 'bg-green-900/60 text-green-300',
  cancelled: 'bg-red-900/40 text-red-400',
}

export default function Badge({ variant = 'flower', children, className = '' }) {
  const style = variants[variant] || 'bg-surface text-muted border border-border'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${style} ${className}`}>
      {children}
    </span>
  )
}
