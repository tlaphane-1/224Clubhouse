import toast from 'react-hot-toast'
import { useAssignDriver } from '../../hooks/useDelivery'

/** Driver picker for one order (Admin → Orders, expanded row). */
export default function DriverAssign({ order, drivers }) {
  const assign = useAssignDriver()
  const locked = ['delivered', 'cancelled'].includes(order.status)
  const options = (drivers ?? []).filter(d => d.active || d.user_id === order.driver_id)

  const onChange = async (e) => {
    const driverId = e.target.value || null
    try {
      await assign.mutateAsync({ orderId: order.id, driverId })
      const name = options.find(d => d.user_id === driverId)?.full_name
      toast.success(driverId ? `Assigned to ${name}` : 'Driver removed')
    } catch (err) {
      e.target.value = order.driver_id ?? ''
      toast.error(err.message || 'Could not assign the driver')
    }
  }

  return (
    <div className="mt-5 pt-5 border-t border-border">
      <label htmlFor={`driver-${order.id}`} className="block text-gold text-xs uppercase tracking-widest mb-2">Driver</label>
      {options.length === 0 ? (
        <p className="text-muted text-sm">No drivers yet — add them under Admin → Drivers.</p>
      ) : (
        <select
          id={`driver-${order.id}`}
          value={order.driver_id ?? ''}
          onChange={onChange}
          disabled={locked || assign.isPending}
          className="input-base text-sm w-full sm:w-72 disabled:opacity-60"
        >
          <option value="">Not assigned</option>
          {options.map(d => <option key={d.user_id} value={d.user_id}>{d.full_name}</option>)}
        </select>
      )}
    </div>
  )
}
