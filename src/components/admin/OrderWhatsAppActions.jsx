import WhatsAppButton from '../ui/WhatsAppButton'
import { eftState } from '../../utils/orderStatus'
import {
  shareLink, chatLink, orderMessage, eftCheckMessage, driverJobMessage, deliveryUpdateMessage,
} from '../../utils/staffWhatsApp'

/**
 * One-tap WhatsApp messages for an order (Admin → Orders, expanded row).
 * Each opens WhatsApp with the text ready; a person picks the chat and sends.
 */
export default function OrderWhatsAppActions({ order, drivers }) {
  const driver = drivers?.find(d => d.user_id === order.driver_id)
  const eft = eftState(order)
  const onTheWay = ['out_for_delivery', 'delivered'].includes(order.status)

  return (
    <div className="mt-5 pt-5 border-t border-border">
      <h4 className="text-gold text-xs uppercase tracking-widest mb-3">WhatsApp</h4>
      <div className="flex flex-wrap gap-2">
        {driver && order.status !== 'cancelled' && order.status !== 'delivered' && (
          driver.phone
            ? <WhatsAppButton href={chatLink(driver.phone, driverJobMessage(order, driver.full_name))}>Send job to {driver.full_name.split(' ')[0]}</WhatsAppButton>
            : <p className="text-muted text-xs self-center">Add {driver.full_name}'s phone under Drivers to message them.</p>
        )}
        <WhatsAppButton href={shareLink(orderMessage(order))}>Share order</WhatsAppButton>
        {(eft === 'awaiting' || eft === 'proof') && (
          <WhatsAppButton href={shareLink(eftCheckMessage(order))}>Share EFT check</WhatsAppButton>
        )}
        {onTheWay && (
          <WhatsAppButton href={shareLink(deliveryUpdateMessage(order, driver?.full_name))}>Share delivery update</WhatsAppButton>
        )}
      </div>
      <p className="text-muted text-xs mt-2">Opens WhatsApp with the message written — pick your group or the driver, then tap Send.</p>
    </div>
  )
}
