// One login belongs to one store: the stamp_user_tenant trigger fixes
// app_metadata.tenant at sign-up (migration 20261102160000), and the server's
// current_tenant() trusts that claim over the site a request comes from. So a
// 224 account signed in on another store's site would read and write 224's
// data there. The site therefore refuses a session from another store.

export const WRONG_STORE = 'wrong_store'

/**
 * True when the signed-in user belongs to this store. An account with no
 * stamp is accepted (every account is stamped since 2026-11-03; refusing an
 * unstamped one could lock a real customer out over a missing claim).
 */
export function accountBelongsHere(user, storeSlug) {
  const stamp = user?.app_metadata?.tenant
  return !stamp || stamp === storeSlug
}

export function wrongStoreError(storeName) {
  const err = new Error(
    `This email is registered with another club. Please use a different email address to join ${storeName}.`,
  )
  err.code = WRONG_STORE
  return err
}
