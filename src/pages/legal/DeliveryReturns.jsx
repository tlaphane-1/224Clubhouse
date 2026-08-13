import { Link } from 'react-router-dom'
import LegalPage, { LegalSection, ReviewNote } from './LegalPage'

/**
 * Delivery & returns policy. The fee/threshold numbers here mirror
 * OrderSummary.jsx (R80 fee, free at R500+) and the place_cod_order RPC —
 * if those change, change this page too.
 */
export default function DeliveryReturns() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Delivery & Returns"
      intro="How delivery works, what to expect at your door, and your return and refund rights under South African law."
    >
      <LegalSection title="1. Delivery area">
        <p>
          We deliver from our store at 224 Rondebult Ave, Libradene, Boksburg. If your address
          falls outside our delivery area, we will contact you before confirming the order —
          orders we cannot deliver are cancelled and nothing is owed.
        </p>
        <ReviewNote>
          the exact delivery area (suburbs / radius around Boksburg) has not been published
          anywhere on the site and needs to be defined here.
        </ReviewNote>
      </LegalSection>

      <LegalSection title="2. Delivery times and fees">
        <ul className="list-disc pl-5 space-y-2">
          <li>Orders are typically delivered within <span className="text-white">2–5 business days</span> of confirmation.</li>
          <li>The delivery fee is <span className="text-white">R80</span>.</li>
          <li>Delivery is <span className="text-white">free for orders of R500 or more</span>.</li>
          <li>
            Payment is <span className="text-white">cash or card on delivery</span> — have your
            payment ready for the driver.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. ID check on delivery (21+)">
        <p>
          Cannabis products are for adults aged 21 and over. The person receiving the order must
          be 21 or older and must be able to show valid identification (SA ID, driver&rsquo;s
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

      <LegalSection title="5. Cooling-off right (ECT Act section 44)">
        <p>
          For purchases made through this website, section 44 of the Electronic Communications and
          Transactions Act gives you the right to cancel the purchase within{' '}
          <span className="text-white">7 days after delivery</span>, without reason and without
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

      <LegalSection title="6. Defective products (Consumer Protection Act)">
        <p>
          Nothing above affects your rights under the Consumer Protection Act. If a product is
          defective, unsafe, or not what was described, you may return it within{' '}
          <span className="text-white">6 months of delivery</span> and choose a repair, a
          replacement, or a full refund. Return costs for defective goods are ours, not yours.
        </p>
      </LegalSection>

      <LegalSection title="7. How to start a return">
        <p>To start a return or report a problem with an order:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Use the{' '}
            <Link to="/contact" className="text-gold hover:text-gold-light transition-colors">contact form</Link>{' '}
            with your order number and the reason for the return, or
          </li>
          <li>
            Message us on WhatsApp at <span className="text-white">+27 75 086 8783</span>, or
          </li>
          <li>Bring the product and your order number to the store at 224 Rondebult Ave, Libradene, Boksburg.</li>
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
