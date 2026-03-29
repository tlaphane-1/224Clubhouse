import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../lib/firebase'

export function useOrderStatus(orderId) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!orderId || !db) return

    const orderRef = ref(db, `orders/${orderId}/status`)
    const unsubscribe = onValue(orderRef, (snapshot) => {
      const val = snapshot.val()
      if (val) setStatus(val)
    })

    return () => unsubscribe()
  }, [orderId])

  return status
}
