const variants = {
  flower: 'bg-green-900/50 text-green-400 border border-green-800',
  edibles: 'bg-orange-900/50 text-orange-400 border border-orange-800',
  accessories: 'bg-blue-900/50 text-blue-400 border border-blue-800',
  merchandise: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800',
  indica: 'bg-purple-900/50 text-purple-300 border border-purple-800',
  sativa: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  hybrid: 'bg-teal-900/50 text-teal-300 border border-teal-800',
  members: 'bg-gold/20 text-gold border border-gold/40',
  // Delivery-flow statuses (mirrors STATUS_BADGE in utils/orderStatus.js)
  pending: 'bg-muted/10 text-muted border border-border',
  confirmed: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  preparing: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  out_for_delivery: 'bg-gold/10 text-gold border border-gold/20',
  delivered: 'bg-green-500/10 text-green-400 border border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/20',
  // Legacy online-payment statuses
  paid: 'bg-green-500/10 text-green-400 border border-green-500/20',
  processing: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  shipped: 'bg-gold/10 text-gold border border-gold/20',
}

export default function Badge({ variant = 'flower', children, className = '' }) {
  const style = variants[variant] || 'bg-surface text-muted border border-border'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${style} ${className}`}>
      {children}
    </span>
  )
}
