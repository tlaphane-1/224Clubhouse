import { storageKey } from '../tenant'

// While the tablet is in table mode (customers use it), staff screens are
// locked until the staff account password is entered again.
const KEY = storageKey('table-lock')

export const isTableLocked = () => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export const lockTable = () => {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode: no lock */ }
}
export const unlockTable = () => {
  try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}
