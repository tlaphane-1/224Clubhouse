import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { addressFromNominatim, distanceKm, mapsLink } from './geo'

describe('distanceKm', () => {
  it('measures Soshanguve to Pretoria CBD at about 26 km', () => {
    const km = distanceKm({ lat: -25.5197, lng: 28.1003 }, { lat: -25.7461, lng: 28.1881 })
    expect(km).toBeGreaterThan(25)
    expect(km).toBeLessThan(28)
  })

  it('is zero for the same point', () => {
    expect(distanceKm({ lat: -26.2, lng: 28.2 }, { lat: -26.2, lng: 28.2 })).toBe(0)
  })
})

describe('addressFromNominatim', () => {
  it('maps a full result onto the checkout fields', () => {
    expect(addressFromNominatim({
      address: { house_number: '702', road: 'Aubrey Matlakala Street', suburb: 'Block L', city: 'Soshanguve', state: 'Gauteng', postcode: '0152' },
    })).toEqual({ street: '702 Aubrey Matlakala Street', city: 'Soshanguve', province: 'Gauteng', postalCode: '0152' })
  })

  it('only returns what it knows, so typed fields are never blanked', () => {
    expect(addressFromNominatim({ address: { road: 'Main Road', town: 'Boksburg', state: 'Somewhere Else', postcode: 'ABC' } }))
      .toEqual({ street: 'Main Road', city: 'Boksburg' })
    expect(addressFromNominatim(null)).toEqual({})
  })

  it('never fills City with an electoral ward name (real Soshanguve result)', () => {
    expect(addressFromNominatim({
      address: { road: 'Lepara Street', suburb: 'Tshwane Ward 34', county: 'City of Tshwane Metropolitan Municipality', state: 'Gauteng', postcode: '0152' },
    })).toEqual({ street: 'Lepara Street', province: 'Gauteng', postalCode: '0152' })
  })

  it('matches the province regardless of case', () => {
    expect(addressFromNominatim({ address: { state: 'kwazulu-natal' } })).toEqual({ province: 'KwaZulu-Natal' })
  })
})

describe('mapsLink', () => {
  it('opens the exact point in Google Maps', () => {
    expect(mapsLink({ lat: -25.5, lng: 28.1 })).toBe('https://www.google.com/maps/search/?api=1&query=-25.5,28.1')
  })
})

describe('checkout attaches the pin before the order emails', () => {
  const src = readFileSync(path.resolve(import.meta.dirname, '../pages/Checkout.jsx'), 'utf8')

  it('calls set_order_pin before send-order-email, so the owner alert can show it', () => {
    const pinAt = src.indexOf("rpc('set_order_pin'")
    const emailAt = src.indexOf(".invoke('send-order-email'")
    expect(pinAt).toBeGreaterThan(-1)
    expect(emailAt).toBeGreaterThan(pinAt)
  })
})
