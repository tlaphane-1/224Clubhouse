import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { safeFileName } from '../utils/safeFileName'
import { withTimeout } from '../utils/withTimeout'

// EFT payment verification (migration 20261007120000). Proofs live in the
// PRIVATE payment-proofs bucket under <uid>/<order id>/; only the customer and
// admins can read them, through short-lived signed URLs.

export const PROOF_MAX_BYTES = 5 * 1024 * 1024
export const PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'

/** Customer: upload a proof of payment and attach it to their EFT order. */
export function useUploadPaymentProof(orderId) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file) => {
      if (!user) throw new Error('Please sign in again')
      if (file.size > PROOF_MAX_BYTES) throw new Error('That file is over 5 MB — try a screenshot or a smaller PDF')
      if (!PROOF_ACCEPT.split(',').includes(file.type)) {
        throw new Error('Please upload a photo, screenshot or PDF')
      }
      const path = `${user.id}/${orderId}/${Date.now()}-${safeFileName(file.name)}`
      const { error: upErr } = await withTimeout(
        supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type }),
        60000,
        'proof upload',
      )
      if (upErr) throw upErr
      const { error } = await supabase.rpc('attach_payment_proof', { p_order_id: orderId, p_path: path })
      if (error) throw error

      // Alert the club — fire and forget; the proof is recorded either way.
      supabase.functions
        .invoke('send-payment-email', { body: { orderId, kind: 'proof' } })
        .catch(() => { /* the proof stands with or without the alert */ })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-orders'] })
      queryClient.invalidateQueries({ queryKey: ['invoice-order'] })
    },
  })
}

/** Admin: mark an EFT payment received (or undo it). */
export function useSetEftPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, received, amountCents = null }) => {
      const { data, error } = await supabase.rpc('admin_set_eft_payment', {
        p_order_id: orderId,
        p_received: received,
        p_amount_cents: amountCents,
      })
      if (error) throw error
      if (received) {
        supabase.functions
          .invoke('send-payment-email', { body: { orderId, kind: 'received' } })
          .catch(() => { /* the payment stands with or without the email */ })
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

/** A 5-minute link to a proof file (customer: own files; admin: any). */
export async function proofUrl(path) {
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}
