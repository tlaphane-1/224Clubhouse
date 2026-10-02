/**
 * Fails a pending request after `ms` instead of leaving the UI stuck.
 *
 * Admin forms set a `saving` flag, await Supabase, and clear the flag in a
 * `finally`. If the request never settles the button reads "Saving..." forever
 * — no error, no toast, no way back except reloading the page. That is not
 * theoretical on this project: a DELETE on `events` was measured hanging for
 * 46 minutes while another transaction held a lock on the table.
 *
 * Racing does not cancel the request server-side; a write may still land. The
 * message therefore tells the admin to refresh and check rather than implying
 * the change was lost, so nobody saves the same thing twice on a slow link.
 */
export const DEFAULT_TIMEOUT_MS = 20000

export function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS, action = 'request') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(
        `The ${action} is taking too long. Refresh the page and check whether it saved before trying again.`,
      )),
      ms,
    )
  })
  // Supabase query builders are thenables, which Promise.race handles fine.
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer))
}
