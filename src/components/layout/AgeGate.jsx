import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { isAgeVerified, setAgeVerified } from '../../utils/ageGate'

export default function AgeGate() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isAgeVerified()) {
      setShow(true)
    }
  }, [])

  const handleYes = () => {
    setAgeVerified()
    setShow(false)
  }

  const handleNo = () => {
    window.location.href = 'https://www.google.com'
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[9999] bg-background flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-center max-w-md w-full"
          >
            {/* Logo */}
            <div className="mb-8">
              <div className="font-heading text-7xl font-bold text-gold tracking-wider">224</div>
              <div className="text-white text-sm tracking-[0.4em] uppercase mt-1 font-light">Clubhouse</div>
            </div>

            {/* Divider */}
            <div className="w-16 h-px bg-gold mx-auto mb-8" />

            <h2 className="font-heading text-2xl font-semibold text-white mb-3">
              Members Lounge
            </h2>
            <p className="text-muted text-sm mb-2">
              This is a private cannabis lifestyle lounge.
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
