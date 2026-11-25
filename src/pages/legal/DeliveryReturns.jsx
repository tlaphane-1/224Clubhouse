import { Link } from 'react-router-dom'
import LegalPage, { LegalSection, ReviewNote } from './LegalPage'
import { tenant, IS_COLLECT } from '../../tenant'
import { MIN_AGE } from '../../utils/age'
import { SHIPPING_FEE, SHIPPING_THRESHOLD } from '../../utils/shipping'
import { EFT_AVAILABLE } from '../../utils/bankDetails'
import { formatTierPrice } from '../../utils/tierPrice'

const { contact } = tenant

/**
 * Collection & returns policy, for a collect store (order online, collect at
 * the club; no delivery). Sections 1–3 replace the delivery sections; the
 * return sections are shared and count from collection instead of delivery.
 */
function CollectionSections() {
  return (
    <>
      <LegalSection title="1. Where and when to collect">
        <p>
          Orders are collected from the club at {contact.street}, {contact.suburb}, {contact.city}{' '}
          ({tenant.hours.status.replace(/^Open /, 'open ')}). We do not deliver. We email you when your
          order is ready for collection; please bring your order number.
        </p>
      </LegalSection>

      <LegalSection title="2. Paying for your order">
        <ul className="list-disc pl-5 space-y-2">
          <li>There is no delivery fee.</li>
          <li>
            Pay by <span className="text-white">cash or card when you collect</span>
            {EFT_AVAILABLE ? <>, or by <span className="text-white">EFT</span> before you collect — the
            order is ready once the payment reflects</> : null}.
          </li>
          <li>
            If an order is not collected, we will contact you on the phone number on the order. Orders
            that are still not collected may be cancelled, and nothing is owed.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={`3. ID check at collection (${MIN_AGE}+)`}>
        <p>
          Cannabis products are for adults aged {MIN_AGE} and over. The person collecting the order
          must be {MIN_AGE} or older and must be able to show valid identification (SA ID,
          driver&rsquo;s licence, or passport) if asked. We will not hand over an order without it.
        </p>
      </LegalSection>
    </>
  )
}

/**
 * Delivery & returns policy. The fee/threshold numbers here mirror
 * utils/shipping.js (R30 fee, free for members and at R500+) and the place_cod_order RPC —
 * if those change, change this page too.
 */
export default function DeliveryReturns() {
  return (
    <LegalPage
      eyebrow="Legal"
      title={IS_COLLECT ? 'Collection & Returns' : 'Delivery & Returns'}
      intro={IS_COLLECT
        ? 'How collecting your order works, and your return and refund rights under South African law.'
        : 'How delivery works, what to expect at your door, and your return and refund rights under South African law.'}
    >
      {IS_COLLECT ? <CollectionSections /> : (<>
      <LegalSection title="1. Delivery area">
        <p>
          We deliver from our store at {contact.street}, {contact.suburb}, {contact.city}. If your address
          falls outside our delivery area, we will contact you before confirming the order —
          orders we cannot deliver are cancelled and nothing is owed.
        </p>
        <ReviewNote>
          the exact delivery area (suburbs / radius around {contact.city}) has not been published
          anywhere on the site and needs to be defined here.
        </ReviewNote>
      </LegalSection>

      <LegalSection title="2. Delivery times and fees">
        <ul className="list-disc pl-5 space-y-2">
          <li>Orders are typically delivered within <span className="text-white">2–5 business days</span> of confirmation.</li>
          <li>The delivery fee is <span className="text-white">{formatTierPrice(SHIPPING_FEE)}</span>.</li>
          <li>Delivery is <span className="text-white">free for active members</span>, and for orders of {formatTierPrice(SHIPPING_THRESHOLD)} or more.</li>
          <li>
            Payment is <span className="text-white">cash or card on delivery</span> — have your
            payment ready for the driver{EFT_AVAILABLE ? <> — or <span className="text-white">EFT</span>, in which case we
            dispatch once the payment reflects</> : null}.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={`3. ID check on delivery (${MIN_AGE}+)`}>
        <p>
          Cannabis products are for adults aged {MIN_AGE} and over. The person receiving the order must
          be {MIN_AGE} or older and must be able to show valid identification (SA ID, driver&rsquo;s
          licence, or passport) if asked. If nobody at the address can verify their age, the
          driver will not hand over the order.
        </p>
      </LegalSection>

      <LegalSection title="4. If you are not home, or delivery is refused">
        <p>
          If nobody is available to receive the order, or the order is refused or fails the age
          check, the driver will attempt to contact you on the phone number on the order. If we
          cannot complete delivery, the order returns to the store and we will contact you to
          arrange redelivery or cancel the order.
        </p>
        <ReviewNote>
          whether a redelivery fee applies after a failed attempt, and how many attempts are made,
          is management&rsquo;s call and should be stated here once decided.
        </ReviewNote>
      </LegalSection>
      </>)}

      <LegalSection title={`${IS_COLLECT ? 4 : 5}. Cooling-off right (ECT Act section 44)`}>
        <p>
          For purchases made through this website, section 44 of the Electronic Communications and
          Transactions Act gives you the right to cancel the purchase within{' '}
          <span className="text-white">7 days after {IS_COLLECT ? 'collection' : 'delivery'}</span>, without reason and without
          penalty. If you cancel, you pay only the direct cost of returning the goods, and we
          refund the purchase price within 30 days of cancellation.
        </p>
        <p>
          <span className="text-white">This right has statutory limits, and we apply them honestly:</span>{' '}
          it can only practically apply to products that come back{' '}
          <span className="text-white">unopened and unused, with seals and packaging intact</span>.
          Consumable cannabis products, edibles and other perishables{' '}
          <span className="text-white">cannot be returned once opened or once the seal is broken</span>,
          for health, hygiene and safety reasons. Unopened, sealed products in resalable condition
          are accepted within the 7-day window.
        </p>
      </LegalSection>

      <LegalSection title={`${IS_COLLECT ? 5 : 6}. Defective products (Consumer Protection Act)`}>
        <p>
          Nothing above affects your rights under the Consumer Protection Act. If a product is
          defective, unsafe, or not what was described, you may return it within{' '}
          <span className="text-white">6 months of {IS_COLLECT ? 'collection' : 'delivery'}</span> and choose a repair, a
          replacement, or a full refund. Return costs for defective goods are ours, not yours.
        </p>
      </LegalSection>

      <LegalSection title={`${IS_COLLECT ? 6 : 7}. How to start a return`}>
        <p>To start a return or report a problem with an order:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Use the{' '}
            <Link to="/contact" className="text-gold hover:text-gold-light transition-colors">contact form</Link>{' '}
            with your order number and the reason for the return, or
          </li>
          <li>
            Message us on WhatsApp at <span className="text-white">{contact.phoneIntl}</span>, or
          </li>
          <li>Bring the product and your order number to the store at {contact.street}, {contact.suburb}, {contact.city}.</li>
        </ul>
        <p>
          You can find your order number on your confirmation email, on the{' '}
          <Link to="/orders" className="text-gold hover:text-gold-light transition-colors">My Orders</Link>{' '}
          page, or via <Link to="/track" className="text-gold hover:text-gold-light transition-colors">Track Order</Link>.
          We confirm receipt of every return request and let you know the outcome once the product
          has been checked.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
