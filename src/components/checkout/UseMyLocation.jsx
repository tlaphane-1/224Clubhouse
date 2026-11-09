import { useState } from 'react'
import { MapPin, CheckCircle } from 'lucide-react'
import { currentPosition, reverseGeocode } from '../../utils/geo'

/**
 * "Use my current location" on the delivery address. Pins the phone's
 * position (saved on the order by set_order_pin) and fills in the address
 * fields it can work out. Optional: the customer can always type instead.
 */
export default function UseMyLocation({ pin, onPin, onAddress }) {
  const [state, setState] = useState('idle') // idle | locating | error
  const [message, setMessage] = useState('')

  const locate = async () => {
    setState('locating')
    setMessage('')
    try {
      const position = await currentPosition()
      onPin(position)
      setState('idle')
      try {
        onAddress(await reverseGeocode(position))
      } catch {
        setMessage('Location pinned. We could not look up the street name, so please type your address below.')
      }
    } catch (err) {
      setState('error')
      setMessage(err.message)
    }
  }

  return (
    <div className="mb-4">
      <button type="button" onClick={locate} disabled={state === 'locating'}
        className="btn-outline w-full min-h-11 inline-flex items-center justify-center gap-2 text-sm disabled:opacity-60">
        <MapPin size={16} />
        {state === 'locating' ? 'Finding you…' : pin ? 'Update my location' : 'Use my current location'}
      </button>
      {pin && (
        <p className="text-green-400 text-xs mt-2 inline-flex items-center gap-1.5" role="status">
          <CheckCircle size={14} /> Location pinned{pin.accuracy ? ` (accurate to about ${pin.accuracy} m)` : ''}. Check the address below.
        </p>
      )}
      {message && (
        <p className={`text-xs mt-2 ${state === 'error' ? 'text-red-400' : 'text-muted'}`} role={state === 'error' ? 'alert' : 'status'}>{message}</p>
      )}
      {!pin && state !== 'error' && (
        <p className="text-muted text-xs mt-2">Helps our driver find you. Only used for this delivery.</p>
      )}
    </div>
  )
}
