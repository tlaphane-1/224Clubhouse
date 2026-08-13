import { Link } from 'react-router-dom'
import LegalPage, { LegalSection } from './LegalPage'

/**
 * Terms of service for the storefront + membership. The checkout agreement
 * checkbox links here — keep this page in step with how checkout actually
 * works (COD, account required, server-confirmed orders).
 */
export default function Terms() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="These terms govern your use of the 224 Clubhouse website, store, and membership. By placing an order or applying for membership you agree to them."
    >
      <LegalSection title="1. Who may use this site (21+ only)">
        <p>
          224 Clubhouse is a private, members-based cannabis lifestyle lounge operating within the
          framework of the Cannabis for Private Purposes Act. Our products and services are
          strictly for adults aged <span className="text-white font-semibold">21 years or older</span>.
          By using this site, placing an order, or applying for membership you confirm that you are
          at least 21 years old. We verify age on membership applications and on delivery, and we
          refuse sale or delivery where age cannot be verified.
        </p>
        <p>
          Certain products are available to club members only, in line with our private-club
          model.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts">
        <p>
          Checkout requires a customer account. You agree to provide accurate, current information
          when registering and ordering, and to keep your login credentials confidential. You are
          responsible for activity on your account. We may suspend or close accounts used in
          breach of these terms.
        </p>
      </LegalSection>

      <LegalSection title="3. Orders and acceptance">
        <p>
          Placing an order on this site is an offer to purchase. Your order is accepted when the
          store confirms it — until then we may decline or cancel an order, for example where an
          item is out of stock, a price was displayed in error, we cannot verify your age, or the
          delivery address falls outside our delivery area. If we cancel an order you have already
          paid for, you will be refunded in full.
        </p>
        <p>
          Payment is currently <span className="text-white">cash or card on delivery</span> — no
          payment is taken online. The total shown at checkout (including any delivery fee) is
          what you pay the driver.
        </p>
      </LegalSection>

      <LegalSection title="4. WhatsApp orders">
        <p>
          You can also send an order to the store on WhatsApp at{' '}
          <span className="text-white">+27 75 086 8783</span>. A WhatsApp order is only confirmed
          once the store replies to confirm it — sending the message does not by itself reserve
          stock or create an order.
        </p>
      </LegalSection>

      <LegalSection title="5. Pricing">
        <p>
          All prices are in South African Rand (ZAR) and include VAT where applicable. We take
          care to price accurately, but where an obvious pricing or description error appears on
          the site we reserve the right to correct it and to cancel affected orders before
          acceptance.
        </p>
      </LegalSection>

      <LegalSection title="6. Delivery">
        <p>
          Orders are typically delivered within <span className="text-white">2–5 business days</span>.
          The delivery fee is <span className="text-white">R80</span>, and delivery is{' '}
          <span className="text-white">free for orders of R500 or more</span>. The recipient must
          be 21 or older and may be asked to show ID on delivery. Full details, including what
          happens if you are not home, are in our{' '}
          <Link to="/delivery-returns" className="text-gold hover:text-gold-light transition-colors">
            Delivery &amp; Returns policy
          </Link>.
        </p>
      </LegalSection>

      <LegalSection title="7. Returns and cooling-off">
        <p>
          Your cooling-off rights under section 44 of the Electronic Communications and
          Transactions Act, your rights in respect of defective goods under the Consumer
          Protection Act, and the applicable exclusions are set out in our{' '}
          <Link to="/delivery-returns" className="text-gold hover:text-gold-light transition-colors">
            Delivery &amp; Returns policy
          </Link>, which forms part of these terms.
        </p>
      </LegalSection>

      <LegalSection title="8. Membership">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Membership is by application and subject to approval by club management, at
            management&rsquo;s discretion. Applicants must be 21 or older and provide accurate
            information, including date of birth for age verification.
          </li>
          <li>
            Each membership tier runs for the duration shown at application and expires at the end
            of that period unless renewed.
          </li>
          <li>Membership is personal and non-transferable.</li>
          <li>
            Members agree to conduct themselves in accordance with the{' '}
            <Link to="/membership" className="text-gold hover:text-gold-light transition-colors">
              12 Club Commandments
            </Link>. Membership may be suspended or revoked for breach of the Commandments or of
            these terms.
          </li>
          <li>Products obtained through the club are for personal use only and may not be resold.</li>
        </ul>
      </LegalSection>

      <LegalSection title="9. Acceptable use">
        <p>
          You may not use this site for anything unlawful, attempt to gain unauthorised access to
          any part of it, place fraudulent orders, or misrepresent your age or identity. We may
          refuse service where we reasonably suspect any of the above.
        </p>
      </LegalSection>

      <LegalSection title="10. Limitation of liability">
        <p>
          Nothing in these terms limits any right you have under the Consumer Protection Act or
          other law that cannot be limited by agreement. Subject to that, 224 Clubhouse is not
          liable for indirect or consequential loss arising from your use of the site, and our
          total liability in connection with any order is limited to the amount you paid for that
          order.
        </p>
      </LegalSection>

      <LegalSection title="11. Governing law">
        <p>
          These terms are governed by the laws of the Republic of South Africa, and any dispute is
          subject to the jurisdiction of the South African courts.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes and contact">
        <p>
          We may update these terms from time to time; the version published here at the time you
          place an order applies to that order. Questions about these terms can be sent via the{' '}
          <Link to="/contact" className="text-gold hover:text-gold-light transition-colors">contact form</Link>{' '}
          or raised in-store at 224 Rondebult Ave, Libradene, Boksburg, 1459.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
