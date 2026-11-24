import { describe, it, expect } from 'vitest'
import { validateCheckout } from './checkoutValidation'

const contact = { name: 'Thabo', email: 'thabo@example.com', phone: '0761234567' }
const noAddress = { ...contact, street: '', apartment: '', city: '', province: '', postalCode: '' }

describe('validateCheckout', () => {
  it('collect: name, email and phone are enough — no address needed', () => {
    expect(validateCheckout(noAddress, { collect: true })).toEqual({})
  })

  it('collect: still requires the contact details', () => {
    const errors = validateCheckout({ ...noAddress, name: '', phone: '' }, { collect: true })
    expect(errors).toEqual({ name: 'Full name is required', phone: 'Phone number is required' })
  })

  it('delivery: the address fields are required, with today\'s messages', () => {
    expect(validateCheckout(noAddress, { collect: false })).toEqual({
      street: 'Street address is required',
      city: 'City is required',
      province: 'Province is required',
      postalCode: 'Postal code is required',
    })
  })
})
