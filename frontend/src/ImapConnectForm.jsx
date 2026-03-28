import { useState } from 'react'

const KNOWN_PROVIDERS = {
  'gmail.com': { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587 },
  'googlemail.com': { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587 },
  'outlook.com': { imapHost: 'imap-mail.outlook.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587 },
  'hotmail.com': { imapHost: 'imap-mail.outlook.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587 },
  'live.com': { imapHost: 'imap-mail.outlook.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587 },
  'msn.com': { imapHost: 'imap-mail.outlook.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587 },
}

function detectServerSettings(emailAddress) {
  const domain = emailAddress.split('@')[1]?.toLowerCase()
  return domain ? (KNOWN_PROVIDERS[domain] ?? null) : null
}

// Shared IMAP credential form. Can be embedded inline (AuthModal) or used inside a modal (Settings).
// Props:
//   onConnect(fields) — called with { email, password, imapHost, imapPort, smtpHost, smtpPort }
//   onCancel() — optional, shows a "Back" button when provided
//   loading — external loading state override
//   error — external error string override
export default function ImapConnectForm({ onConnect, onCancel, loading: externalLoading, error: externalError }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('mail.rodistogo.net')
  const [imapPort, setImapPort] = useState(993)
  const [smtpHost, setSmtpHost] = useState('mail.rodistogo.net')
  const [smtpPort, setSmtpPort] = useState(465)
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const loading = externalLoading ?? localLoading
  const error = externalError ?? localError

  function handleEmailChange(e) {
    const val = e.target.value
    setEmail(val)
    const detected = detectServerSettings(val)
    if (detected) {
      setImapHost(detected.imapHost)
      setImapPort(detected.imapPort)
      setSmtpHost(detected.smtpHost)
      setSmtpPort(detected.smtpPort)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password || !imapHost || !imapPort || !smtpHost || !smtpPort) {
      setLocalError('Please fill in all fields.')
      return
    }
    setLocalError('')
    if (externalLoading === undefined) setLocalLoading(true)
    try {
      await onConnect({ email, password, imapHost, imapPort: Number(imapPort), smtpHost, smtpPort: Number(smtpPort) })
    } catch (err) {
      setLocalError(err.message || 'Connection failed.')
    } finally {
      if (externalLoading === undefined) setLocalLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email address</label>
          <input
            type="email"
            value={email}
            onChange={handleEmailChange}
            placeholder="you@example.com"
            required
            disabled={loading}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your email password or app password"
            required
            disabled={loading}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">IMAP Host</label>
            <input
              type="text"
              value={imapHost}
              onChange={(e) => setImapHost(e.target.value)}
              placeholder="imap.example.com"
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Port</label>
            <input
              type="number"
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">SMTP Host</label>
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Port</label>
            <input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${
            loading
              ? 'bg-indigo-400 text-white cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
          }`}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </form>
  )
}
