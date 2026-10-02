/**
 * Client-side purchase gate for `is_member_only` products.
 *
 * The server (`place_cod_order`) is the real boundary — it rejects the WHOLE
 * order with a raw error if any line is member-only and the buyer isn't an
 * active member. This helper exists so the customer never reaches that error:
 * the same verdict is computed at the product, cart and checkout surfaces.
 *
 * Two rules, and they differ deliberately:
 *
 * - LOADING (signed in, membership query still in flight) → NOT locked. An
 *   active member must never see a "join to unlock" flash on their own
 *   products, and the server still enforces the rule if we guess wrong.
 * - ERRORED (query settled with a failure) → LOCKED, i.e. fail CLOSED. A
 *   failed membership read is not evidence of membership; treating it as
 *   "maybe a member" just moves the rejection to the end of checkout.
 *
 * Signed-out visitors are definitively non-members (the query never runs for
 * them, so it never settles — hence the explicit `!user` branch).
 *
 * @param {object|null} user         AuthContext user
 * @param {object} membership        the whole useMyMembership() return value
 */
export function memberPurchaseGate(user, membership) {
  const isActiveMember = membership?.effectiveStatus === 'active'
  const settled = !user || Boolean(membership?.isSuccess) || Boolean(membership?.isError)

  /** @param {{is_member_only?: boolean}} product */
  const isLocked = (product) =>
    Boolean(product?.is_member_only) && !isActiveMember && settled

  return { isActiveMember, settled, isLocked }
}
