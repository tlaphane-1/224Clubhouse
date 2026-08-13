import { Link } from 'react-router-dom'
import LegalPage, { LegalSection } from './LegalPage'

/**
 * POPIA-oriented privacy policy. Content is specific to what this app
 * actually collects (see Checkout, Membership, Contact, newsletter flows) —
 * update this page whenever a new category of personal information is added.
 */
export default function PrivacyPolicy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="How 224 Clubhouse collects, uses, stores and protects your personal information, and the rights you have under the Protection of Personal Information Act, 2013 (POPIA)."
    >
      <LegalSection title="1. Who we are">
        <p>
          224 Clubhouse is a private cannabis lifestyle lounge at 224 Rondebult Ave, Libradene,
          Boksburg, 1459, South Africa. For the purposes of POPIA, 224 Clubhouse is the
          &ldquo;responsible party&rdquo; for the personal information described in this policy.
        </p>
        <p>
          <span className="text-white font-semibold">Information Officer:</span> 224 Clubhouse
          Management. You can reach the Information Officer through the{' '}
          <Link to="/contact" className="text-gold hover:text-gold-light transition-colors">contact form</Link>{' '}
          on this site or in person at the store.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect">
        <p>We only collect information you give us directly:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="text-white">Account details</span> — your email address and a password
            (stored in hashed form by our authentication provider, never readable by us).
          </li>
          <li>
            <span className="text-white">Order details</span> — your name, email, phone number,
            delivery address, the items you ordered, and your order history.
          </li>
          <li>
            <span className="text-white">Membership applications</span> — your full name, phone
            number, <span className="text-white">date of birth</span> (required, to verify you are
            21 or older) and, optionally, your{' '}
            <span className="text-white">South African ID number</span>. Your ID number is used
            solely to verify your identity and age for membership. We treat it with heightened
            care: access is restricted to club management and it is never shared for marketing
            or any other purpose.
          </li>
          <li>
            <span className="text-white">Newsletter</span> — your email address, if you subscribe.
          </li>
          <li>
            <span className="text-white">Contact messages</span> — your name, email and message
            when you use the contact form.
          </li>
          <li>
            <span className="text-white">WhatsApp orders</span> — if you order via WhatsApp, we see
            your WhatsApp number and message. WhatsApp itself is governed by WhatsApp&rsquo;s own
            privacy policy.
          </li>
        </ul>
        <p>We do not use advertising trackers and we do not buy data about you from anyone.</p>
      </LegalSection>

      <LegalSection title="3. Why we collect it (purpose and legal basis)">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="text-white">Age and identity verification</span> — cannabis products
            are for adults only. Verifying that members and customers are 21 or older is a legal
            and club requirement, and is the reason we ask for your date of birth (and optionally
            your ID number) on membership applications.
          </li>
          <li>
            <span className="text-white">Order fulfilment</span> — we need your name, contact
            details and delivery address to process, deliver and confirm your orders (performance
            of a contract with you).
          </li>
          <li>
            <span className="text-white">Membership administration</span> — processing your
            application, managing your tier, its start and expiry dates, and club communications.
          </li>
          <li>
            <span className="text-white">Transactional email</span> — order receipts and status
            updates sent to the email on your account.
          </li>
          <li>
            <span className="text-white">Newsletter</span> — sent only with your consent; you can
            unsubscribe at any time.
          </li>
          <li>
            <span className="text-white">Legal obligations</span> — keeping records we are required
            to keep, for example for tax purposes.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Where your information is stored">
        <p>
          Our customer database and authentication run on Supabase, hosted on servers in the
          European Union. This means your personal information is transferred outside South
          Africa; POPIA permits this where the recipient is subject to laws or contracts that
          provide an adequate level of protection, which applies to our EU-hosted infrastructure.
          The website itself is hosted on Google Firebase Hosting.
        </p>
        <p>
          Data is encrypted in transit, and access to personal information in our database is
          restricted by role-based access controls so that only club management can read
          membership and order records.
        </p>
      </LegalSection>

      <LegalSection title="5. Who we share it with">
        <p>We never sell your personal information. We share it only with:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="text-white">Resend</span> — our email delivery provider, which
            processes your email address and order details in order to send you receipts and
            notifications.
          </li>
          <li>
            <span className="text-white">A payment processor</span> — only if and when online card
            payments are enabled on this site (currently orders are paid on delivery, so no
            payment card details pass through this website at all).
          </li>
          <li>
            <span className="text-white">Authorities</span> — where the law requires us to.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. How long we keep it">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="text-white">Order records</span> — kept for as long as required for
            accounting and tax purposes under South African law.
          </li>
          <li>
            <span className="text-white">Membership records</span> — kept for the duration of your
            membership and a reasonable period afterwards, after which they are deleted or
            de-identified.
          </li>
          <li>
            <span className="text-white">Newsletter subscription</span> — until you unsubscribe.
          </li>
          <li>
            <span className="text-white">Contact messages</span> — as long as needed to handle your
            enquiry.
          </li>
        </ul>
        <p>
          Where you ask us to delete information and no law requires us to keep it, we will
          delete it.
        </p>
      </LegalSection>

      <LegalSection title="7. Cookies and local storage">
        <p>
          We do not use advertising or analytics cookies. The site stores a small amount of data
          in your browser&rsquo;s local storage to work properly:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>An age-gate flag remembering that you confirmed you are 21 or older.</li>
          <li>Your shopping cart contents.</li>
          <li>Your login session token, if you sign in.</li>
          <li>A short-lived record of your most recent order so the confirmation page survives a refresh.</li>
        </ul>
        <p>Clearing your browser data removes all of these.</p>
      </LegalSection>

      <LegalSection title="8. Your rights under POPIA">
        <p>You have the right to:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><span className="text-white">Access</span> — ask what personal information we hold about you and receive a copy.</li>
          <li><span className="text-white">Correction</span> — ask us to correct or update inaccurate information.</li>
          <li><span className="text-white">Deletion</span> — ask us to delete your information where we are not legally required to keep it.</li>
          <li><span className="text-white">Objection</span> — object to processing, including withdrawing consent to the newsletter at any time.</li>
        </ul>
        <p>
          To exercise any of these rights, contact the Information Officer via the{' '}
          <Link to="/contact" className="text-gold hover:text-gold-light transition-colors">contact form</Link>{' '}
          or in-store. We may ask you to verify your identity before acting on a request, and we
          will respond within a reasonable time.
        </p>
      </LegalSection>

      <LegalSection title="9. Complaints">
        <p>
          If you believe we have handled your personal information unlawfully and we have not
          resolved your complaint, you have the right to lodge a complaint with the Information
          Regulator (South Africa). The Regulator&rsquo;s contact details are published on its
          official pages at justice.gov.za/inforeg.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to this policy">
        <p>
          We may update this policy from time to time. The &ldquo;Last updated&rdquo; date below
          reflects the current version; material changes will be announced on the site.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
