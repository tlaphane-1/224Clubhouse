import { storageKey } from '../tenant'

const AGE_GATE_KEY = storageKey('age-verified')

export function isAgeVerified() {
  return localStorage.getItem(AGE_GATE_KEY) === 'true'
}

export function setAgeVerified() {
  localStorage.setItem(AGE_GATE_KEY, 'true')
}
