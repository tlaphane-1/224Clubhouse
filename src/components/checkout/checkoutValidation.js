// Checkout form validation. A collect store (order online, collect at the club)
// asks for no address, so only the contact details are required there.
export function validateCheckout(form, { collect }) {
  const errors = {}
  if (!form.name.trim()) errors.name = 'Full name is required'
  if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errors.email = 'Valid email required'
  if (!form.phone.trim()) errors.phone = 'Phone number is required'
  if (collect) return errors
  if (!form.street.trim()) errors.street = 'Street address is required'
  if (!form.city.trim()) errors.city = 'City is required'
  if (!form.province) errors.province = 'Province is required'
  if (!form.postalCode.trim()) errors.postalCode = 'Postal code is required'
  return errors
}
