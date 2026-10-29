import { describe, it, expect } from 'vitest'
import { mapEmbedUrl } from '../utils/mapEmbed'

describe('mapEmbedUrl', () => {
  it('returns null when the key is unset', () => {
    expect(mapEmbedUrl(undefined, 'x')).toBeNull()
  })

  it('returns null when the key is blank', () => {
    expect(mapEmbedUrl('  ', 'x')).toBeNull()
  })

  it('builds the embed URL with an encoded key and query', () => {
    expect(mapEmbedUrl('K', '224 Rondebult Road, Libradene, Boksburg')).toBe(
      'https://www.google.com/maps/embed/v1/place?key=K&q=224%20Rondebult%20Road%2C%20Libradene%2C%20Boksburg',
    )
  })
})
