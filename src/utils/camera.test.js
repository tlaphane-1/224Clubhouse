import { describe, it, expect } from 'vitest'
import { cameraErrorMessage } from './camera'

describe('cameraErrorMessage', () => {
  it('explains each camera problem in plain words', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toBe('Camera blocked. Allow camera access for this site in the browser settings, then try again.')
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toBe('No camera found on this device.')
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toBe('The camera is busy. Close other apps using the camera, then try again.')
    expect(cameraErrorMessage(new Error('x'))).toBe('Could not open the camera.')
  })
  it('says when the browser cannot open the camera inside the page', () => {
    expect(cameraErrorMessage({ name: 'Unsupported' })).toBe('This browser cannot open the camera here.')
  })
})
