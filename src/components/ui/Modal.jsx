import { useEffect, useId } from 'react'
import { X } from 'lucide-react'

/**
 * @param sheet   on phones, open as a full-screen sheet instead of a centred
 *                box (long forms shouldn't scroll inside a small window).
 *                From sm up it is the normal centred modal.
 * @param footer  optional actions pinned below the scrolling body, so the
 *                submit button is always on screen.
 */
export default function Modal({ isOpen, onClose, title, children, size = 'md', sheet = false, footer = null }) {
  const titleId = useId()

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const sizes = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-2xl',
    lg: 'sm:max-w-4xl',
    xl: 'sm:max-w-6xl',
  }

  if (!isOpen) return null

  return (
    <div className={`fixed inset-0 z-[80] flex justify-center ${sheet ? 'items-stretch sm:items-center sm:p-4' : 'items-center p-4'}`}>
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${sizes[size]} bg-surface border-border shadow-2xl flex flex-col overflow-hidden animate-scaleIn ${
          sheet
            ? 'h-svh sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-2xl sm:border'
            : 'max-h-[90vh] rounded-2xl border'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:p-6 border-b border-border flex-shrink-0">
          <h3 id={titleId} className="font-heading text-xl font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring flex-shrink-0 w-11 h-11 -mr-2 flex items-center justify-center text-muted hover:text-white
                       transition-colors rounded-lg hover:bg-border"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>

        {footer && (
          <div className="flex-shrink-0 px-4 pt-3 pb-4 sm:p-6 border-t border-border bg-surface">{footer}</div>
        )}
      </div>
    </div>
  )
}
