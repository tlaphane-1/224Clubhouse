import { useState } from 'react'
import { isAgeVerified, setAgeVerified } from '../../utils/ageGate'
import BrandLogo from '../ui/BrandLogo'

export default function AgeGate() {
  // localStorage is read synchronously, so the initial value can come straight
  // from it — no effect needed, and no render pass with the gate hidden.
  const [show, setShow] = useState(() => !isAgeVerified())

  const handleYes = () => {
    setAgeVerified()
    setShow(false)
  }

  const handleNo = () => {
    window.location.href = 'https://www.google.com'
  }

  if (!show) return null

  return (
        <div
          className="fixed inset-0 z-[9999] bg-background flex items-center justify-center p-6 animate-fade"
        >
          <div className="text-center max-w-md w-full animate-scaleIn">
            {/* Logo */}
            <BrandLogo className="h-16 sm:h-20 mx-auto mb-8" />

            {/* Divider */}
            <div className="w-16 h-px bg-gold mx-auto mb-8" />

            <h2 className="font-heading text-2xl font-semibold text-white mb-3">
              Members' Club
            </h2>
            <p className="text-muted text-sm mb-2">
              Premium cannabis, delivered to your door.
            </p>
            <p className="text-white text-base mb-10">
              Are you <span className="text-gold font-semibold">21 or older?</span>
            </p>

            <div className="flex gap-4">
              <button
                onClick={handleNo}
                className="flex-1 border border-border text-muted hover:border-muted hover:text-white
                           py-4 rounded-lg font-semibold tracking-wider uppercase text-sm transition-all duration-200"
              >
                No, I'm Under 21
              </button>
              <button
                onClick={handleYes}
                className="flex-1 btn-gold py-4 rounded-lg font-semibold tracking-wider uppercase text-sm"
              >
                Yes, I'm 21+
              </button>
            </div>

            <p className="text-muted text-xs mt-6">
              By entering, you agree that you are of legal age to consume cannabis products in your jurisdiction.
            </p>
          </div>
        </div>
  )
}
