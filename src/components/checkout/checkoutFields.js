// Checkout field ids are `checkout-<key>`. Checkout.jsx focuses the first
// invalid one, in this on-screen order, when Place Order fails validation.
export const CHECKOUT_FIELD_ORDER = ['name', 'email', 'phone', 'street', 'apartment', 'city', 'postalCode', 'province']
export const checkoutFieldId = (key) => `checkout-${key}`
