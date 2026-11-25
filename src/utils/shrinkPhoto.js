import { fitWithin } from './shifts'

// Camera photos from phones/tablets can be several MB; the selfie bucket
// takes 3 MB. Redraw at most 1280 px on the long side as JPEG (quality 0.8),
// which is plenty for a face and usually 100–300 KB. If the browser can't
// decode the photo (e.g. HEIC outside Safari), the original is used.
const MAX_SIDE = 1280
export const MAX_SELFIE_BYTES = 3 * 1024 * 1024

export async function shrinkPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return blob ? new File([blob], 'selfie.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}
