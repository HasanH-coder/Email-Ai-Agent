import { useState, useRef, useEffect, useCallback } from 'react'
import { startGoogleConnect, startMicrosoftConnect } from './services/connect'

export default function AuthModal({ isOpen, onClose }) {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')
  const [microsoftLoading, setMicrosoftLoading] = useState(false)
  const [microsoftError, setMicrosoftError] = useState('')
  const backdropRef = useRef(null)

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setGoogleLoading(false)
      setGoogleError('')
      setMicrosoftLoading(false)
      setMicrosoftError('')
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  async function handleGoogleAuth() {
    setGoogleLoading(true)
    setGoogleError('')
    setMicrosoftError('')
    try {
      window.localStorage.setItem('mailpilot.oauth_provider_hint', 'gmail')
      console.log('Setting oauth_provider_hint before Google OAuth click handler:', 'gmail')
      await startGoogleConnect()
    } catch (error) {
      console.error('Google OAuth unexpected error:', error)
      setGoogleError(error.message || 'Google OAuth failed.')
      setGoogleLoading(false)
    }
  }

  async function handleMicrosoftAuth() {
    setMicrosoftLoading(true)
    setMicrosoftError('')
    setGoogleError('')
    try {
      window.localStorage.setItem('mailpilot.oauth_provider_hint', 'outlook')
      console.log('Setting oauth_provider_hint before Microsoft OAuth click handler:', 'outlook')
      await startMicrosoftConnect(true)
    } catch (error) {
      console.error('Microsoft OAuth unexpected error:', error)
      setMicrosoftError(error.message || 'Microsoft OAuth failed.')
      setMicrosoftLoading(false)
    }
  }

  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === backdropRef.current) onClose()
    },
    [onClose]
  )

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Authentication"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden animate-[fadeScaleIn_0.2s_ease-out]">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer z-10"
          aria-label="Close modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <span className="text-xl font-bold text-slate-900">MailPilot</span>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={googleLoading || microsoftLoading}
              className={`w-full py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                googleLoading || microsoftLoading
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 cursor-pointer'
              }`}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6A9.4 9.4 0 0 0 2.6 12 9.4 9.4 0 0 0 12 21.4c5.4 0 9-3.8 9-9.1 0-.6-.1-1-.2-1.5H12Z" />
                <path fill="#34A853" d="M3.7 7.3l3.2 2.3C7.7 8 9.7 6.5 12 6.5c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6c-3.7 0-7 2.1-8.3 4.7Z" />
                <path fill="#4A90E2" d="M12 21.4c2.5 0 4.7-.8 6.2-2.3l-2.9-2.4c-.8.6-1.9 1.2-3.3 1.2-3.9 0-5.3-2.6-5.5-3.9L3.3 16.5c1.3 2.6 4.6 4.9 8.7 4.9Z" />
                <path fill="#FBBC05" d="M3.3 16.5A9.3 9.3 0 0 1 2.6 12c0-1.5.4-3 .9-4.3l3.4 2.5c-.2.5-.3 1.1-.3 1.8 0 .6.1 1.3.3 1.8l-3.6 2.7Z" />
              </svg>
              {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
            </button>

            <button
              type="button"
              onClick={handleMicrosoftAuth}
              disabled={googleLoading || microsoftLoading}
              className={`w-full py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                googleLoading || microsoftLoading
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 cursor-pointer'
              }`}
            >
              <span className="grid grid-cols-2 gap-0.5 w-4 h-4" aria-hidden="true">
                <span className="bg-[#F25022] rounded-[1px]" />
                <span className="bg-[#7FBA00] rounded-[1px]" />
                <span className="bg-[#00A4EF] rounded-[1px]" />
                <span className="bg-[#FFB900] rounded-[1px]" />
              </span>
              {microsoftLoading ? 'Redirecting to Microsoft...' : 'Continue with Microsoft'}
            </button>

            {googleError && <p className="text-sm text-red-600 text-center">{googleError}</p>}
            {microsoftError && <p className="text-sm text-red-600 text-center">{microsoftError}</p>}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
