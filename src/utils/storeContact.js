import { tenant } from '../tenant'

// How a customer reaches the store when a self-service link fails: by email
// when the store has one (contact.email is optional in tenant.json), otherwise
// by phone.
const { email, phoneTel, phoneDisplay } = tenant.contact

export const STORE_CONTACT = email
  ? { verb: 'email', href: `mailto:${email}`, label: email }
  : { verb: 'call', href: `tel:${phoneTel}`, label: phoneDisplay }
