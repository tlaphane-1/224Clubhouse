// Every value interpolated into an email template comes from the database
// (customer names, product names, tier names, order numbers) and is ultimately
// user-supplied. Unescaped, a name like `<img src=x onerror=...>` or a stray
// `</div>` ships inside branded mail from a verified domain. Escape on the way
// into the HTML, never trust the source.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
