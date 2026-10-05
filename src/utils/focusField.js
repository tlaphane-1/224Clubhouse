// Bring a form field into view and focus it — used when a submit fails
// validation. On a phone the error is usually off-screen above the button, so
// a toast alone leaves the customer hunting for it.
export function focusField(id) {
  const el = document.getElementById(id)
  if (!el) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  el.focus({ preventScroll: true })
}
