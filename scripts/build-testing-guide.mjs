// Builds docs/TESTING_GUIDE.html (+ .pdf) — role-based functional test script.
// Reuses the USER_GUIDE stylesheet so both documents look like one family.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(import.meta.dirname, '..')
const logo = fs.readFileSync(path.join(ROOT, '224-images-staging/224-logo-fav-1-480x142.png')).toString('base64')
const baseStyle = fs.readFileSync(path.join(ROOT, 'docs/USER_GUIDE.html'), 'utf8').match(/<style>[\s\S]*?<\/style>/)[0]

// Extra styles this document needs on top of the shared house style.
const extraStyle = `
<style>
  .masthead {
    background: #0a0a0a;
    border-radius: 6px;
    padding: 22pt 20pt 18pt;
    text-align: center;
    margin-bottom: 20pt;
  }
  .masthead img { width: 190pt; height: auto; display: block; margin: 0 auto 10pt; }
  .masthead .kicker {
    color: #C9A84C;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 8.5pt;
    letter-spacing: 4pt;
    text-transform: uppercase;
    margin: 0;
  }
  .role-card {
    border: 1px solid var(--rule);
    border-left: 4px solid var(--gold);
    border-radius: 4px;
    padding: 10pt 14pt;
    margin: 12pt 0 16pt;
    background: #fbf9f4;
  }
  .role-card p { margin: 4pt 0; }
  table.tests { width: 100%; border-collapse: collapse; margin: 8pt 0 16pt; font-size: 10.5pt; }
  table.tests th {
    background: #0a0a0a; color: #fff; text-align: left; padding: 6pt 8pt;
    font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8.5pt;
    letter-spacing: 1pt; text-transform: uppercase; font-weight: 600;
  }
  table.tests td { border-bottom: 1px solid var(--rule); padding: 7pt 8pt; vertical-align: top; }
  table.tests tr:nth-child(even) td { background: #faf8f3; }
  table.tests .id { font-family: "Courier New", monospace; color: var(--gold-dark); font-weight: bold; white-space: nowrap; }
  table.tests .res { width: 46pt; text-align: center; color: var(--muted); font-size: 14pt; line-height: 1; }
  .known { background: var(--warn-bg); border-left: 4px solid var(--warn-border); padding: 10pt 14pt; margin: 14pt 0; border-radius: 3px; }
  .known p, .known li { font-size: 10.5pt; }
  .sig { margin-top: 20pt; border-top: 1px solid var(--rule); padding-top: 12pt; font-size: 10.5pt; }
  .sig td { padding: 10pt 8pt 4pt 0; }
  .sig .line { border-bottom: 1px solid var(--muted); display: inline-block; min-width: 150pt; }
  h2 { border-top: 2px solid var(--gold); padding-top: 10pt; margin-top: 22pt; }
  @media print { .role-card, .known, table.tests tr { page-break-inside: avoid; } }
</style>`

const T = (id, what, how, expect) =>
  `<tr><td class="id">${id}</td><td>${what}<br><span style="color:var(--muted);font-size:9.5pt">${how}</span></td><td>${expect}</td><td class="res">☐</td></tr>`

const head = `<tr><th>ID</th><th>What to test / how</th><th>What should happen</th><th>Pass</th></tr>`

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>224 Clubhouse — Functional Testing Guide</title>
${baseStyle}
${extraStyle}
</head>
<body>
<div class="page">

<div class="masthead">
  <img src="data:image/png;base64,${logo}" alt="224 Clubhouse">
  <p class="kicker">Functional Testing Guide</p>
</div>

<p class="lede">A step-by-step script for checking that the website works, written for the people who will actually use it. Work through the section for each role, tick the box when it behaves as described, and note anything that doesn't.</p>

<h2>Before you start</h2>
<table>
  <thead><tr><th>What</th><th>Detail</th></tr></thead>
  <tbody>
    <tr><td><strong>Website</strong></td><td><code>https://224clubhouse.web.app</code></td></tr>
    <tr><td><strong>Admin login</strong></td><td><code>https://224clubhouse.web.app/admin/login</code></td></tr>
    <tr><td><strong>Store WhatsApp</strong></td><td><code>+27 75 086 8783</code></td></tr>
    <tr><td><strong>Test on</strong></td><td>One phone <em>and</em> one computer. Several problems only appear on one of them.</td></tr>
    <tr><td><strong>You will need</strong></td><td>An email address you can open during the test (for sign-up and password links).</td></tr>
  </tbody>
</table>

<div class="tip">
  <p><strong>Tip:</strong> Use a real email you can check. Several tests depend on receiving a message. If you want to test sign-up more than once, most email providers let you add <code>+test</code> before the @ sign — for example <code>you+test1@gmail.com</code> — and the mail still arrives in your normal inbox.</p>
</div>

<h2>Roles at a glance</h2>
<table>
  <thead><tr><th>Role</th><th>Who this is</th><th>Section</th></tr></thead>
  <tbody>
    <tr><td><strong>Visitor</strong></td><td>Anyone browsing, not signed in</td><td>1</td></tr>
    <tr><td><strong>Customer</strong></td><td>Signed-in shopper with an account</td><td>2</td></tr>
    <tr><td><strong>Member</strong></td><td>Customer with an approved membership</td><td>3</td></tr>
    <tr><td><strong>Admin / Owner</strong></td><td>You and your staff, in the control room</td><td>4</td></tr>
  </tbody>
</table>

<h2>1. Visitor — not signed in</h2>
<div class="role-card">
  <p><strong>Who:</strong> A first-time visitor from Instagram or a Google search.</p>
  <p><strong>What matters:</strong> They can look around freely, and the site is honest about what needs an account.</p>
  <p><strong>Setup:</strong> Open the site in a private/incognito window so you are definitely signed out.</p>
</div>
<table class="tests">
<thead>${head}</thead>
<tbody>
${T('V-1', 'Age gate', 'Open the site fresh in a private window.', 'A 21+ age check appears before anything else. Confirming lets you in.')}
${T('V-2', 'Browse the shop', 'Go to Store, open any product.', 'Products load with photos and prices. No errors, no blank areas.')}
${T('V-3', 'Members-only product', 'Find a product marked "Members".', 'Instead of Add to Cart you see a locked "Join to unlock" button that takes you to the Membership page.')}
${T('V-4', 'Add to cart', 'Add a normal product, open the cart.', 'The item, quantity and total are right. R80 delivery, free at R500 or more.')}
${T('V-5', 'Checkout needs an account', 'From the cart, press Proceed to Checkout.', 'You are asked to sign in or create an account before you can order.')}
${T('V-6', 'WhatsApp ordering', 'In the cart, choose Collection, then Send order on WhatsApp.', 'WhatsApp opens with a ready-written order to +27 75 086 8783 listing your items and total.')}
${T('V-7', 'WhatsApp delivery needs an address', 'Switch to Delivery, leave the address blank, press send.', 'It refuses and points at the address box instead of sending an incomplete order.')}
${T('V-8', 'Membership page', 'Open Membership.', 'All three tiers show with the correct prices (R10 daily, R30 weekly, R50 monthly).')}
${T('V-9', 'Applying needs an account', 'Choose a tier and press Apply.', 'You are asked to sign in first. No payment is requested before that.')}
${T('V-10', 'Events', 'Open Events.', 'Upcoming events appear. Past events do not.')}
${T('V-11', 'Contact form', 'Send yourself a test message through Contact.', 'You get a clear confirmation. (You will read this message in test A-9.)')}
${T('V-12', 'Legal pages', 'Open Privacy, Terms and Delivery &amp; Returns from the footer.', 'All three open and read correctly. They currently show a "Draft" banner — expected until you approve them.')}
${T('V-13', 'Track an order', 'Open Track Order.', 'You can look up an order using an order number and email.')}
</tbody>
</table>

<h2>2. Customer — signed in</h2>
<div class="role-card">
  <p><strong>Who:</strong> Somebody buying from you.</p>
  <p><strong>What matters:</strong> Ordering works, and afterwards they can find the order themselves without phoning you.</p>
  <p><strong>Setup:</strong> Create a brand-new account during test C-1 so you see exactly what a real customer sees.</p>
</div>
<table class="tests">
<thead>${head}</thead>
<tbody>
${T('C-1', 'Create an account', 'Sign In from the top bar, then Create Account.', 'You are told to confirm your email. The confirmation email arrives and its link brings you back to the site signed in.')}
${T('C-2', 'You can tell you are signed in', 'Look at the top bar.', 'Your email shows in the top right with a menu (My Account, My Orders, Sign Out).')}
${T('C-3', 'Account page', 'Open My Account.', 'You see your email, your membership status, and links to orders and tracking.')}
${T('C-4', 'Place an order', 'Add something to the cart and complete checkout.', 'Your email is filled in and locked. The order goes through and you land on a confirmation page with an order number.')}
${T('C-5', 'Receipt email', 'Check your inbox after ordering.', 'A 224 Clubhouse receipt arrives with the order number and "amount due on delivery" (not "paid").')}
${T('C-6', 'Order history', 'Open My Orders.', 'The order you just placed is listed.')}
${T('C-7', 'Order detail', 'Press View on that order.', 'You see the items, the delivery address, the total and a progress timeline.')}
${T('C-8', 'Reorder', 'On the order detail page press Reorder.', 'The items go back into your cart at today\\u2019s prices. Anything out of stock is skipped and named.')}
${T('C-9', 'Address is remembered', 'Start a second checkout.', 'Your name, phone and address are already filled in from last time. Typing over them works normally.')}
${T('C-10', 'Forgot password', 'Sign out, then use "Forgot password?" on the sign-in form.', 'A reset email arrives; its link lets you set a new password and signs you in.')}
${T('C-11', 'Cart privacy on a shared device', 'Add something to the cart, then Sign Out.', 'The cart is emptied — the next person on that device does not inherit your basket.')}
${T('C-12', 'Members-only still blocked', 'While signed in but not a member, open a Members product.', 'Still locked. If one is already in your cart, the cart says so and checkout is blocked until it is removed.')}
</tbody>
</table>

<h2>3. Member — approved membership</h2>
<div class="role-card">
  <p><strong>Who:</strong> A customer who has paid and been approved.</p>
  <p><strong>What matters:</strong> They can see their own membership, and it actually unlocks something.</p>
  <p><strong>Setup:</strong> Use the account from section 2. You will need an admin to approve the application in test A-4 partway through.</p>
</div>
<table class="tests">
<thead>${head}</thead>
<tbody>
${T('M-1', 'Apply for a membership', 'On Membership, pick a tier and apply.', 'The form asks for name, phone and date of birth. Your account email is shown and cannot be changed. The button says payment happens at the club.')}
${T('M-2', 'Under-21 is refused', 'Try a date of birth under 21 years old, including one a few days short.', 'It is refused immediately, with a clear message.')}
${T('M-3', 'Application recorded', 'Submit the application.', 'You are told it is received and that you pay at the club. My Account shows it as pending. No card details are ever asked for.')}
${T('M-4', 'No duplicates', 'Try to apply a second time while pending.', 'You are told you already have an application, and no second one is created.')}
${T('M-5', 'Approval', 'Ask the admin to approve you (test A-4), then refresh My Account.', 'Status becomes active with an expiry date counting from the approval, not from when you applied.')}
${T('M-6', 'Confirmation email', 'Check your inbox.', 'A confirmation arrives with your tier and valid-until date.')}
${T('M-7', 'Members-only unlocked', 'Open the Members-only product from test V-3.', 'Add to Cart now works, and the order goes through checkout normally.')}
${T('M-8', 'Expiry (optional, slower test)', 'Ask the admin to set the membership to Expired.', 'Your account shows it expired and offers to renew, rather than pretending you were never a member.')}
</tbody>
</table>

<h2>4. Admin / Owner — the control room</h2>
<div class="role-card">
  <p><strong>Who:</strong> You and trusted staff.</p>
  <p><strong>What matters:</strong> Nothing reaches customers that you cannot see, change, or answer.</p>
  <p><strong>Setup:</strong> Sign in at <code>/admin/login</code>. Best done on a computer.</p>
</div>
<table class="tests">
<thead>${head}</thead>
<tbody>
${T('A-1', 'Admin login is protected', 'While signed out, try to open /admin/dashboard directly.', 'You are sent to the login page, not into the control room.')}
${T('A-2', 'Dashboard figures', 'Sign in and read the dashboard.', 'Revenue counts delivered orders only; money not yet collected shows separately as outstanding.')}
${T('A-3', 'See the order', 'Open Orders and find the customer\\u2019s test order.', 'It is listed with the order number, customer and total.')}
${T('A-4', 'Change status and notify', 'Move it to Confirmed, then Out for Delivery.', 'The status changes, and the customer receives an email for each step.')}
${T('A-5', 'Approve a membership', 'Open Memberships and approve the pending application.', 'It becomes active with an expiry date, and the member gets a confirmation email.')}
${T('A-6', 'Member details', 'Expand that membership row.', 'You can see date of birth, ID number, dates and a history of who changed what.')}
${T('A-7', 'Walk-in member', 'Press Add Walk-in Member and create one with a tier.', 'Created as active straight away. Under-21 dates of birth are refused.')}
${T('A-8', 'Link a walk-in to their account', 'On a walk-in with no account, press Link to Account and enter their email.', 'It links, and that person can then buy members-only products online.')}
${T('A-9', 'Read contact messages', 'Open Messages.', 'The test message from V-11 is there, with a one-click reply link.')}
${T('A-10', 'Newsletter list', 'Open Newsletter and press Export CSV.', 'Subscribers are listed and the file downloads, ready for a mailing tool.')}
${T('A-11', 'Products', 'Add a product, upload a photo, then edit and hide it.', 'All of it works and the change shows on the shop immediately.')}
${T('A-12', 'Stock is protected', 'Set a product to 1 in stock and order it.', 'Stock drops to 0 and the product can no longer be over-ordered.')}
${T('A-13', 'Tiers', 'Open the Membership Tiers section and change a price.', 'The new price appears on the public Membership page. Existing members keep what they paid for.')}
${T('A-14', 'Events', 'Add an event with a date and photo.', 'It appears on the public Events page.')}
${T('A-15', 'Phone check', 'Open the admin area on your phone.', 'The menu and order list are usable on a small screen.')}
</tbody>
</table>

<h2>Known limitations — not faults</h2>
<div class="known">
<p>These are known and deliberate. Please do not log them as bugs.</p>
<ul>
  <li><strong>Emails come from a different domain.</strong> Until <code>224clubhouse.co.za</code> is verified with the mail provider, messages are sent from another verified domain. The name still reads 224 Clubhouse.</li>
  <li><strong>Legal pages show a "Draft" banner.</strong> They stay marked as drafts until management has read and approved them. Two questions still need your answer: your delivery area, and what happens when a delivery fails.</li>
  <li><strong>Sign-up and password emails are slow in bulk.</strong> The account mailer is limited to a few messages an hour until a dedicated mail service is connected. Fine for testing, not for a launch-day rush.</li>
  <li><strong>Online card payment is off.</strong> Orders are cash or card on delivery by design.</li>
  <li><strong>Membership is pay-at-the-club.</strong> The Paystack merchant account is still being applied for, so there is no online payment yet. Members apply on the website and pay in person; you approve them once they have paid. Online payment switches on later without any other change.</li>
  <li><strong>Old orders placed before accounts existed</strong> do not appear under My Orders. They are still found through Track Order.</li>
</ul>
</div>

<h2>Reporting a problem</h2>
<p>For anything that fails, write down these four things — they are usually enough to fix it without guesswork:</p>
<ol>
  <li>The test ID (for example <strong>C-7</strong>).</li>
  <li>Phone or computer, and which browser.</li>
  <li>What you expected, and what actually happened.</li>
  <li>A screenshot if you can — especially of any error message.</li>
</ol>

<table class="sig">
  <tr>
    <td>Tested by: <span class="line"></span></td>
    <td>Role: <span class="line"></span></td>
  </tr>
  <tr>
    <td>Date: <span class="line"></span></td>
    <td>Tests passed: <span class="line"></span></td>
  </tr>
</table>

<footer class="brand">224 Clubhouse — Functional Testing Guide</footer>

</div>
</body>
</html>`

const outHtml = path.join(ROOT, 'docs/TESTING_GUIDE.html')
fs.writeFileSync(outHtml, html, 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('file:///' + outHtml.replace(/\\/g, '/'), { waitUntil: 'networkidle' })
await page.pdf({
  path: path.join(ROOT, 'docs/TESTING_GUIDE.pdf'),
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', right: '15mm', bottom: '18mm', left: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#6b6b6b;font-family:Georgia,serif;padding:0 15mm;display:flex;justify-content:space-between;">' +
    '<span>224 Clubhouse — Functional Testing Guide</span><span class="pageNumber"></span></div>',
})
await browser.close()
console.log('WROTE docs/TESTING_GUIDE.html and docs/TESTING_GUIDE.pdf')
