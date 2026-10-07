import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import tailwindConfig from '../../../tailwind.config.js'

// Brand background token (no raw hex in components — docs/DESIGN_SYSTEM.md).
const { background } = tailwindConfig.theme.extend.colors

const DISMISS_KEY = '224-driver-install-dismissed'

// Head tags that make /driver installable as its own app (public/driver.webmanifest).
// Added only while the driver portal is mounted, so the shop itself is not
// offered as an install.
const HEAD_TAGS = [
  ['link', { rel: 'manifest', href: '/driver.webmanifest' }],
  ['link', { rel: 'apple-touch-icon', href: '/icons/driver-192.png' }],
  ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
  ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
  ['meta', { name: 'apple-mobile-web-app-title', content: '224 Driver' }],
  ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }],
  ['meta', { name: 'theme-color', content: background }],
]

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/**
 * Adds the driver-app head tags and shows a small, dismissible install hint:
 * an "Install app" button where the browser supports it (Android Chrome), or
 * "Share → Add to Home Screen" on iPhone. Nothing once installed.
 */
export default function InstallDriverApp() {
  const [prompt, setPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [standalone] = useState(isStandalone)

  useEffect(() => {
    const added = HEAD_TAGS.map(([tag, attrs]) => {
      const el = document.createElement(tag)
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
      document.head.appendChild(el)
      return el
    })
    const onPrompt = (e) => {
      e.preventDefault() // show our own button instead of the browser's mini-bar
      setPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => {
      added.forEach(el => el.remove())
      window.removeEventListener('beforeinstallprompt', onPrompt)
    }
  }, [])

  if (standalone || dismissed) return null
  const ios = isIos()
  if (!prompt && !ios) return null

  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* storage blocked — hide for this visit only */ }
  }

  const install = async () => {
    prompt.prompt()
    await prompt.userChoice.catch(() => null)
    setPrompt(null)
  }

  return (
    <div className="bg-surface border border-gold/20 rounded-xl p-3 flex items-center gap-3">
      <Download size={18} className="text-gold flex-shrink-0" />
      <p className="text-sm text-muted flex-1">
        {prompt
          ? 'Install the driver app on your phone for one-tap access.'
          : <>Install on your iPhone: tap <span className="text-white">Share</span> then <span className="text-white">Add to Home Screen</span>.</>}
      </p>
      {prompt && (
        <button type="button" onClick={install} className="btn-outline h-11 px-4 text-xs uppercase tracking-widest flex-shrink-0">
          Install app
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss install hint"
        className="focus-ring rounded-lg w-11 h-11 flex items-center justify-center text-muted hover:text-white flex-shrink-0">
        <X size={16} />
      </button>
    </div>
  )
}
