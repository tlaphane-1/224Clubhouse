// Plain-words messages for camera problems (getUserMedia errors).
const MESSAGES = {
  NotAllowedError: 'Camera blocked. Allow camera access for this site in the browser settings, then try again.',
  SecurityError: 'Camera blocked. Allow camera access for this site in the browser settings, then try again.',
  NotFoundError: 'No camera found on this device.',
  OverconstrainedError: 'No camera found on this device.',
  NotReadableError: 'The camera is busy. Close other apps using the camera, then try again.',
  Unsupported: 'This browser cannot open the camera here.',
}

export function cameraErrorMessage(err) {
  return MESSAGES[err?.name] ?? 'Could not open the camera.'
}
