/**
 * Collect stores (order online, collect at the club) must show no delivery or
 * driver wording. A cheap guard that every customer-facing file which mentions
 * delivery was considered for collect mode: it must read the fulfilment flag.
 * The real check of the words is the E420 walkthrough in the rollout list.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTenant } from '../../tenants/loadTenant.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FLAG = /\b(IS_COLLECT|FULFILMENT|SHOW_DELIVERY_FEE|labelsFor)\b/

const CUSTOMER_FILES = [
  'src/pages/Checkout.jsx',
  'src/components/checkout/CheckoutForm.jsx',
  'src/components/checkout/OrderSummary.jsx',
  'src/pages/Cart.jsx',
  'src/utils/cartToast.js',
  'src/pages/OrderDetail.jsx',
  'src/pages/TrackOrder.jsx',
  'src/pages/OrderConfirmation.jsx',
  'src/pages/Invoice.jsx',
  'src/pages/Account.jsx',
  'src/pages/legal/DeliveryReturns.jsx',
  'src/pages/legal/Terms.jsx',
  'src/pages/legal/PrivacyPolicy.jsx',
  'src/pages/Home.jsx',
  'src/pages/ProductDetail.jsx',
  'src/pages/Membership.jsx',
  'src/components/layout/Footer.jsx',
  'src/components/store/WhatsAppOrderPanel.jsx',
]

describe('collect-mode wording', () => {
  it.each(CUSTOMER_FILES)('%s reads the fulfilment flag', (file) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    expect(src).toMatch(FLAG)
  })

  it('explosive420 names the returns page without "delivery"', () => {
    const t = loadTenant('explosive420')
    expect(t.seo.routes['/delivery-returns'].title).not.toMatch(/deliver/i)
    expect(t.seo.routes['/delivery-returns'].description).not.toMatch(/deliver/i)
  })
})
