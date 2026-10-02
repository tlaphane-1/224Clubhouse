// Shared password rules for account creation (CustomerAuth signup) and the
// password-reset page — one source of truth so the two flows can't drift.

export const MIN_PASSWORD_LENGTH = 6

/**
 * Validate a new password + confirmation pair.
 * Returns a user-facing error message string, or null when valid.
 */
export function validateNewPassword(password, confirm) {
  if ((password?.length ?? 0) < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password !== confirm) {
    return 'Passwords do not match'
  }
  return null
}
