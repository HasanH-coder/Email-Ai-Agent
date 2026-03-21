import { useState, useRef, useCallback, useEffect } from 'react'
import { startGoogleConnect, startMicrosoftConnect } from './services/connect'
import { getSupabase } from './services/supabaseClient'



const EMAIL_STORAGE_KEYS = {
  gmail: 'mailpilot:gmailEmails',
  outlook: 'mailpilot:outlookEmails:v2',
}


const OAUTH_PROVIDER_HINT_STORAGE_KEY = 'mailpilot.oauth_provider_hint'

function mapOauthProviderToMailbox(provider) {
  if (provider === 'google' || provider === 'gmail') return 'gmail'
  if (provider === 'azure' || provider === 'outlook') return 'outlook'
  return null
}

function readAndClearProviderHint(clear = false) {
  if (typeof window === 'undefined') return null
  const rawHint = window.sessionStorage.getItem(OAUTH_PROVIDER_HINT_STORAGE_KEY)
  const mappedHint = mapOauthProviderToMailbox(rawHint)
  if (clear && mappedHint) {
    window.sessionStorage.removeItem(OAUTH_PROVIDER_HINT_STORAGE_KEY)
  }
  return mappedHint
}

function writeProviderTokenStatus(provider, hasToken) {
  void provider
  void hasToken
}

function getConnectedAccountState(rows) {
  const nextConnectedAccounts = { gmail: false, outlook: false }
  const nextConnectedEmails = { gmail: '', outlook: '' }

  for (const account of rows ?? []) {
    const mailboxProvider = mapOauthProviderToMailbox(account?.provider)
    if (!mailboxProvider) continue
    nextConnectedAccounts[mailboxProvider] = true
    nextConnectedEmails[mailboxProvider] = account?.email || ''
  }

  return { nextConnectedAccounts, nextConnectedEmails }
}

function getFirstConnectedProvider(connectedAccounts) {
  if (connectedAccounts.gmail) return 'gmail'
  if (connectedAccounts.outlook) return 'outlook'
  return null
}

function normalizeEmailPins(emails) {
  return emails.map((email) => ({ ...email, pinned: Boolean(email.pinned) }))
}

function getAvatarFromSender(sender) {
  const initials = (sender || 'GM')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')

  return initials || 'GM'
}

function formatEmailTimestamp(internalDate, fallbackDate = '') {
  if (!internalDate) {
    return { time: fallbackDate, date: fallbackDate }
  }

  const parsedDate = new Date(Number(internalDate))
  if (Number.isNaN(parsedDate.getTime())) {
    return { time: fallbackDate, date: fallbackDate }
  }

  return {
    time: parsedDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }),
    date: parsedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  }
}

function normalizeGmailEmail(email) {
  const sender = email.fromName || email.fromEmail || email.from || 'Unknown Sender'
  const senderEmail = email.fromEmail || ''
  const { time, date } = formatEmailTimestamp(email.internalDate, email.date || '')
  const labelIds = Array.isArray(email.labelIds) ? email.labelIds : []

  return {
    id: email.id,
    sender,
    email: senderEmail,
    subject: email.subject || '(No Subject)',
    preview: email.snippet || '',
    bodyText: email.bodyText || '',
    bodyHtml: email.bodyHtml || '',
    time,
    date,
    internalDate: email.internalDate || null,
    labelIds,
    read: !labelIds.includes('UNREAD'),
    starred: labelIds.includes('STARRED'),
    avatar: getAvatarFromSender(sender),
    avatarColor: 'bg-indigo-500',
    provider: 'gmail',
    pinned: false,
    bodyLoaded: Boolean(email.bodyText || email.bodyHtml),
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
  }
}

function normalizeGmailSentEmail(email) {
  const { time } = formatEmailTimestamp(email.internalDate, email.date || '')

  return {
    id: email.id,
    to: email.to || email.fromName || email.fromEmail || email.from || '',
    subject: email.subject || '(No Subject)',
    body: email.snippet || '',
    time,
    provider: 'gmail',
    hasAttachments: Boolean(email.hasAttachments),
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
  }
}

function normalizeGmailDraft(draft) {
  const { time } = formatEmailTimestamp(draft.internalDate, draft.date || '')

  return {
    id: draft.id,
    to: draft.to || '',
    subject: draft.subject || '(No Subject)',
    body: draft.snippet || '',
    time,
  }
}

function normalizeOutlookSentEmail(email) {
  const { time } = formatEmailTimestamp(email.internalDate, email.date || '')

  return {
    id: email.id,
    to: email.to || '',
    subject: email.subject || '(No Subject)',
    body: email.snippet || '',
    time,
    provider: 'outlook',
    conversationId: email.conversationId || email.id,
    hasAttachments: Boolean(email.hasAttachments),
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
  }
}

function normalizeOutlookDraft(draft) {
  const { time } = formatEmailTimestamp(draft.internalDate, draft.date || '')

  return {
    id: draft.id,
    to: draft.to || '',
    subject: draft.subject || '(No Subject)',
    body: draft.snippet || '',
    time,
  }
}

function normalizeOutlookEmail(email) {
  const sender = email.fromName || email.fromEmail || email.from || 'Unknown Sender'
  const senderEmail = email.fromEmail || ''
  const internalDate = email.internalDate || (email.date ? new Date(email.date).getTime() : null)
  const { time, date } = formatEmailTimestamp(internalDate, email.date || '')

  return {
    id: email.id,
    sender,
    email: senderEmail,
    subject: email.subject || '(No Subject)',
    preview: email.snippet || '',
    bodyText: email.bodyText || '',
    bodyHtml: email.bodyHtml || '',
    time,
    date,
    internalDate,
    read: Boolean(email.isRead),
    starred: false,
    avatar: getAvatarFromSender(sender),
    avatarColor: 'bg-blue-500',
    provider: 'outlook',
    pinned: Boolean(email.flagged),
    bodyLoaded: Boolean(email.bodyText || email.bodyHtml),
    conversationId: email.conversationId || email.id,
    hasAttachments: Boolean(email.hasAttachments),
    attachments: Array.isArray(email.attachments) ? email.attachments : [],
  }
}

function groupOutlookEmailsByThread(emails) {
  const threadMap = new Map()
  const threadOrder = []

  for (const email of emails) {
    const threadId = email.conversationId || email.id
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, [])
      threadOrder.push(threadId)
    }
    threadMap.get(threadId).push(email)
  }

  return threadOrder.map((threadId) => {
    const threadEmails = threadMap.get(threadId)
    // Sort asc (oldest first) for the expanded view
    const sorted = [...threadEmails].sort((a, b) => (a.internalDate || 0) - (b.internalDate || 0))
    // Latest = email with highest internalDate (use reduce to avoid null-internalDate sorting bugs)
    const latest = threadEmails.reduce((best, email) =>
      (email.internalDate || 0) > (best.internalDate || 0) ? email : best,
      threadEmails[0]
    )
    return {
      conversationId: threadId,
      emails: sorted,
      latest,
      count: sorted.length,
    }
  })
}

function mergeEmailsById(existingEmails, nextEmails) {
  const emailMap = new Map(existingEmails.map((email) => [email.id, email]))

  for (const email of nextEmails) {
    const previousEmail = emailMap.get(email.id)
    if (!previousEmail) {
      emailMap.set(email.id, email)
      continue
    }

    const mergedEmail = { ...previousEmail, ...email }

    // Preserve the fully loaded message body when a lighter inbox refresh arrives later.
    if (previousEmail.bodyLoaded && !email.bodyLoaded) {
      mergedEmail.bodyText = previousEmail.bodyText
      mergedEmail.bodyHtml = previousEmail.bodyHtml
      mergedEmail.bodyLoaded = previousEmail.bodyLoaded
    }

    // Preserve attachments from the detailed fetch
    if (previousEmail.attachments?.length > 0 && !email.attachments?.length) {
      mergedEmail.attachments = previousEmail.attachments
    }

    const gmailReadOverrideUntil = recentGmailReadOverrides.get(email.id) || 0
    if (previousEmail.provider === 'gmail' && previousEmail.read && !email.read && gmailReadOverrideUntil > Date.now()) {
      mergedEmail.read = true
      mergedEmail.labelIds = Array.isArray(previousEmail.labelIds)
        ? previousEmail.labelIds.filter((label) => label !== 'UNREAD')
        : []
    }

    emailMap.set(email.id, mergedEmail)
  }

  return Array.from(emailMap.values()).sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0))
}

function buildEmailHtmlDocument(bodyHtml = '') {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" rel="noopener noreferrer" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: Arial, sans-serif;
        color: #0f172a;
        background: #ffffff;
        line-height: 1.5;
        word-break: break-word;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      table {
        max-width: 100%;
      }
      a {
        color: #2563eb;
      }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`
}

function loadEmailsFromStorage(storageKey, fallbackEmails, options = {}) {
  const { useFallbackWhenEmpty = false } = options
  const normalizedFallback = normalizeEmailPins(fallbackEmails)
  if (typeof window === 'undefined') return normalizedFallback

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return normalizedFallback
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return normalizedFallback
    if (useFallbackWhenEmpty && parsed.length === 0) return normalizedFallback
    return normalizeEmailPins(parsed)
  } catch {
    return normalizedFallback
  }
}

function groupOutlookThreadsByDate(threads) {
  const groups = []
  for (const thread of threads) {
    const label = thread.latest.date || 'Unknown Date'
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup.label === label) {
      lastGroup.threads.push(thread)
    } else {
      groups.push({ label, threads: [thread] })
    }
  }
  return groups
}

function groupEmailsByDate(emails) {
  const groups = []

  for (const email of emails) {
    const label = email.date || 'Unknown Date'
    const lastGroup = groups[groups.length - 1]

    if (lastGroup && lastGroup.label === label) {
      lastGroup.emails.push(email)
    } else {
      groups.push({ label, emails: [email] })
    }
  }

  return groups
}

function getDomainFromEmail(email = '') {
  const normalizedEmail = email.trim().toLowerCase()
  const atIndex = normalizedEmail.lastIndexOf('@')

  if (atIndex === -1) return ''

  return normalizedEmail.slice(atIndex + 1)
}

const GMAIL_AVATAR_DOMAIN_OVERRIDES = {
  chatgpt: 'openai.com',
  openai: 'openai.com',
  linkedin: 'linkedin.com',
  coursera: 'coursera.org',
  icloud: 'icloud.com',
  'deeplearning.ai': 'deeplearning.ai',
}

const gmailLogoUrlCache = new Map()
const gmailLogoRequestCache = new Map()
const recentGmailReadOverrides = new Map()

function getGmailAvatarDomain(sender = '', senderEmail = '') {
  const normalizedSender = sender.trim().toLowerCase()
  const normalizedEmail = senderEmail.trim().toLowerCase()

  for (const [key, domain] of Object.entries(GMAIL_AVATAR_DOMAIN_OVERRIDES)) {
    if (normalizedSender.includes(key) || normalizedEmail.includes(key)) {
      return domain
    }
  }

  return getDomainFromEmail(senderEmail)
}

async function resolveGmailLogoUrl(domain) {
  if (!domain) return null
  if (gmailLogoUrlCache.has(domain)) {
    return gmailLogoUrlCache.get(domain)
  }
  if (gmailLogoRequestCache.has(domain)) {
    return gmailLogoRequestCache.get(domain)
  }

  const request = (async () => {
    try {
      const response = await fetch(`http://localhost:5001/api/logo?domain=${encodeURIComponent(domain)}`)
      const responseData = await response.json()
      const nextLogoUrl = response.ok ? (responseData.logoUrl || null) : null
      console.log('[gmail-avatar] backend logo URL result:', { domain, logoUrl: nextLogoUrl, ok: response.ok })
      gmailLogoUrlCache.set(domain, nextLogoUrl)
      return nextLogoUrl
    } catch {
      console.log('[gmail-avatar] backend logo URL request failed:', { domain })
      gmailLogoUrlCache.set(domain, null)
      return null
    } finally {
      gmailLogoRequestCache.delete(domain)
    }
  })()

  gmailLogoRequestCache.set(domain, request)
  return request
}

function GmailAvatar({ sender = '', senderEmail, initials, sizeClass = 'w-9 h-9', textClass = 'text-xs', className = '' }) {
  const domain = getGmailAvatarDomain(sender, senderEmail)
  const fallbackLogoUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : ''
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState(() => (domain ? (gmailLogoUrlCache.get(domain) || null) : null))
  const [logoFailed, setLogoFailed] = useState(false)
  const logoUrl = resolvedLogoUrl || fallbackLogoUrl

  console.log('[gmail-avatar] resolving avatar:', {
    sender,
    senderEmail,
    domain,
    backendLogoUrl: resolvedLogoUrl,
    fallbackGoogleFaviconUrl: fallbackLogoUrl || null,
    finalLogoUrlUsed: logoFailed ? null : (logoUrl || null),
  })

  useEffect(() => {
    let cancelled = false

    setLogoFailed(false)
    setResolvedLogoUrl(domain ? (gmailLogoUrlCache.get(domain) || null) : null)

    if (!domain || gmailLogoUrlCache.has(domain)) {
      return () => {
        cancelled = true
      }
    }

    resolveGmailLogoUrl(domain).then((nextLogoUrl) => {
      if (!cancelled) {
        setResolvedLogoUrl(nextLogoUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [domain])

  return (
    <div className={`${sizeClass} rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden ${className}`}>
      {logoUrl && !logoFailed ? (
        <img
          src={logoUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => {
            console.log('[gmail-avatar] logo failed to load:', {
              sender,
              senderEmail,
              domain,
              attemptedLogoUrl: logoUrl,
            })
            setLogoFailed(true)
          }}
        />
      ) : (
        <div className={`w-full h-full rounded-full bg-indigo-500 flex items-center justify-center font-bold text-white ${textClass}`}>
          {initials}
        </div>
      )}
    </div>
  )
}

// --- Icons ---
function InboxIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-17.5 0V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v6.75m-19.5 0v4.5A2.25 2.25 0 004.5 19.5h15a2.25 2.25 0 002.25-2.25v-4.5" />
    </svg>
  )
}

function DraftIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function SentIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.27 3.13a59.76 59.76 0 0 1 18.22 8.87 59.77 59.77 0 0 1-18.22 8.88L6 12Zm0 0h7.5" />
    </svg>
  )
}

function SettingsIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function SignOutIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  )
}

function SearchIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}

function StarIcon({ className, filled }) {
  return filled ? (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" />
    </svg>
  ) : (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  )
}

function PinIcon({ className, filled }) {
  return (
    <svg className={className} fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15 4.5 4.5 4.5-3 3v4.5L12 21v-4.5L7.5 12l3-3V4.5H15z"
      />
    </svg>
  )
}

function ReplyIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 10.5 3.75 15.75 9 21m-5.25-5.25h9.75A6.75 6.75 0 0 1 20.25 22.5v0"
      />
    </svg>
  )
}

function PaperclipIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
    </svg>
  )
}

function PlusIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function SparklesIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  )
}

function XIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SendIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  )
}

function PencilIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}

function TrashIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function ImageIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-15A2.25 2.25 0 012.25 15.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 14.25 4.5-4.5a1.5 1.5 0 012.121 0l4.5 4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.25 12.75 1.5-1.5a1.5 1.5 0 012.121 0l2.379 2.379" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 8.25h.008v.008H8.25V8.25z" />
    </svg>
  )
}


function ChevronRightIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentFileIcon({ mimeType = '' }) {
  if (mimeType === 'application/pdf') {
    return <span className="text-xs font-bold text-red-500 shrink-0">PDF</span>
  }
  if (mimeType.startsWith('image/')) {
    return <ImageIcon className="w-4 h-4 text-green-500 shrink-0" />
  }
  if (mimeType.includes('word') || mimeType.includes('document')) {
    return <span className="text-xs font-bold text-blue-600 shrink-0">DOC</span>
  }
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
    return <span className="text-xs font-bold text-green-600 shrink-0">XLS</span>
  }
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return <span className="text-xs font-bold text-orange-500 shrink-0">PPT</span>
  }
  if (mimeType.startsWith('video/')) {
    return <span className="text-xs font-bold text-purple-500 shrink-0">VID</span>
  }
  if (mimeType.startsWith('audio/')) {
    return <span className="text-xs font-bold text-indigo-500 shrink-0">AUD</span>
  }
  if (mimeType.includes('zip') || mimeType.includes('compressed')) {
    return <span className="text-xs font-bold text-yellow-600 shrink-0">ZIP</span>
  }
  return <PaperclipIcon className="w-4 h-4 text-slate-400 shrink-0" />
}



// --- Reusable Confirm Modal ---
function ConfirmModal({ isOpen, title, message, confirmLabel, confirmClass, onCancel, onConfirm }) {
  const backdropRef = useRef(null)
  const handleBackdrop = useCallback((e) => {
    if (e.target === backdropRef.current) onCancel()
  }, [onCancel])

  if (!isOpen) return null
  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-[fadeScaleIn_0.15s_ease-out]">
        <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-500 mb-6">{message}</p>
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${confirmClass || 'text-white bg-red-600 hover:bg-red-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}


// --- Connect Account Modal ---
function ConnectModal({ isOpen, provider, onCancel, onConnect }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const backdropRef = useRef(null)

  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onCancel()
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    onConnect(email.trim())
    setEmail('')
    setPassword('')
  }

  function handleCancel() {
    setEmail('')
    setPassword('')
    onCancel()
  }

  if (!isOpen) return null

  const providerName = provider === 'gmail' ? 'Gmail' : 'Outlook'
  const providerColor = provider === 'gmail' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={'Connect ' + providerName}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[fadeScaleIn_0.15s_ease-out]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className={'w-9 h-9 rounded-lg flex items-center justify-center ' + providerColor}>
            {provider === 'gmail' ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08L16.91 14l1.957-1.41v-2.534l-1.957 1.38L12.924 8.6V7.157h10.26c.226 0 .418.08.578.233.158.152.238.35.238.576v-.58zM14.078 5.07v14.64L0 17.488V3.293l14.078 1.778zm-2.89 4.252c-.533-.754-1.268-1.13-2.206-1.13-.918 0-1.654.386-2.2 1.16-.55.773-.822 1.772-.822 2.997 0 1.174.264 2.127.793 2.86.53.734 1.248 1.1 2.157 1.1.963 0 1.72-.37 2.27-1.113.55-.743.823-1.733.823-2.97 0-1.28-.272-2.284-.816-3.018v.114zm-1.16 5.057c-.267.477-.648.716-1.143.716-.486 0-.87-.245-1.15-.735-.28-.49-.42-1.14-.42-1.948 0-.84.14-1.506.42-1.998.282-.49.67-.737 1.168-.737.483 0 .863.24 1.142.72.278.48.418 1.142.418 1.985 0 .844-.145 1.52-.435 1.997z" />
              </svg>
            )}
          </div>
          <h3 className="text-base font-bold text-slate-900">{'Connect ' + providerName}</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-3">
            <div>
              <label htmlFor="connect-email" className="block text-xs font-medium text-slate-500 mb-1">Email</label>
              <input
                id="connect-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={'you@' + (provider === 'gmail' ? 'gmail.com' : 'outlook.com')}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="connect-password" className="block text-xs font-medium text-slate-500 mb-1">Password</label>
              <input
                id="connect-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
            </div>
          </div>
          <div className="flex items-center gap-3 justify-end mt-5">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// --- Compose Modal (also used for editing drafts) ---
function ComposeModal({ isOpen, onClose, initialData, onSaveDraft, onSendEmail, activeProvider, signature, useSignature }) {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [attachments, setAttachments] = useState([])
  const [step, setStep] = useState('compose') // compose | review
  const [generatedBody, setGeneratedBody] = useState('')
  const [editMode, setEditMode] = useState('manual') // manual | ai
  const [aiEditPrompt, setAiEditPrompt] = useState('')
  const [manualBody, setManualBody] = useState('')
  const [composeMessage, setComposeMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [draftSaveFailed, setDraftSaveFailed] = useState(false)
  const backdropRef = useRef(null)
  const attachmentButtonRef = useRef(null)
  const fileInputRef = useRef(null)
  const isEditing = !!initialData
  const hasRecipient = to.trim().length > 0
  const hasPrompt = aiPrompt.trim().length > 0
  const canGenerateInNewEmail = hasRecipient && hasPrompt
  const canGenerateInEditMode = hasRecipient
  const canGenerate = isEditing ? canGenerateInEditMode : canGenerateInNewEmail

  useEffect(() => {
    if (!isOpen) return
    if (initialData) {
      setTo(initialData.to || '')
      setCc('')
      setSubject(initialData.subject || '')
      setManualBody(initialData.body || '')
      setAiPrompt(initialData.body || '')
      setEditMode('manual')
      setStep('compose')
      setGeneratedBody('')
      setAiEditPrompt('')
      setComposeMessage('')
      setIsSending(false)
      setIsClosing(false)
      setDraftSaveFailed(false)
    } else {
      setTo('')
      setCc('')
      setSubject('')
      setAiPrompt('')
      setAttachments([])
      setStep('compose')
      setGeneratedBody('')
      setEditMode('manual')
      setAiEditPrompt('')
      setManualBody('')
      setComposeMessage('')
      setIsSending(false)
      setIsClosing(false)
      setDraftSaveFailed(false)
    }
  }, [isOpen, initialData])

  function handleBackdrop(e) {
    if (isClosing || isSending) return
    if (e.target === backdropRef.current) void handleClose()
  }

  function handleAttachFileClick() {
    fileInputRef.current?.click()
  }

  function handleFileInputChange(e) {
    const maxBytes = activeProvider === 'outlook' ? 150 * 1024 * 1024 : 25 * 1024 * 1024
    const limitLabel = activeProvider === 'outlook' ? '150 MB' : '25 MB'
    const files = Array.from(e.target.files || [])
    const errors = []
    const valid = []
    for (const file of files) {
      if (file.size > maxBytes) {
        errors.push(`"${file.name}" exceeds the ${limitLabel} limit.`)
      } else {
        valid.push({ id: Date.now() + Math.random(), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, file })
      }
    }
    if (errors.length > 0) setComposeMessage(errors.join(' '))
    if (valid.length > 0) setAttachments((prev) => [...prev, ...valid])
    e.target.value = ''
  }

  function handleRemoveAttachment(id) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function getSupabaseAccessToken() {
    const supabase = getSupabase()
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  }

  async function callGenerateEmailApi(userPrompt) {
    const token = await getSupabaseAccessToken()
    const response = await fetch('http://localhost:5001/api/ai/generate-email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient: to, subject, userPrompt }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to generate email.')
    return data.emailText
  }

  async function handleGenerate() {
    if (!canGenerate) return
    const prompt = (isEditing && editMode === 'manual' ? manualBody : aiPrompt).trim() || subject || 'a professional email'
    setIsGenerating(true)
    setComposeMessage('')
    try {
      let emailText = await callGenerateEmailApi(prompt)
      const effectiveSig = useSignature ? signature : ''
      if (effectiveSig) emailText = emailText + '\n\n' + effectiveSig
      setGeneratedBody(emailText)
      setStep('review')
    } catch (error) {
      setComposeMessage(error?.message || 'Failed to generate email.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleGenerateAndSend() {
    if (!canGenerateInNewEmail) return
    const prompt = (isEditing && editMode === 'manual' ? manualBody : aiPrompt).trim() || subject || 'a professional email'
    setIsGenerating(true)
    setComposeMessage('')
    let body = ''
    try {
      body = await callGenerateEmailApi(prompt)
      const effectiveSig = useSignature ? signature : ''
      if (effectiveSig) body = body + '\n\n' + effectiveSig
    } catch (error) {
      setComposeMessage(error?.message || 'Failed to generate email.')
      setIsGenerating(false)
      return
    }
    setIsGenerating(false)
    if (onSendEmail) {
      try {
        setIsSending(true)
        await onSendEmail({
          to,
          cc,
          subject,
          body,
          draftId: isEditing ? initialData?.id : null,
        })
      } catch (error) {
        setComposeMessage(error?.message || 'Failed to send email.')
        setIsSending(false)
        return
      }
    }
    setIsSending(false)
    await handleClose({ saveDraft: false })
  }

  async function handleAiRewrite() {
    if (!hasRecipient) {
      setComposeMessage('Enter a recipient email in the To field first.')
      return
    }
    const prompt = aiEditPrompt.trim() || 'more professional and concise'
    setIsGenerating(true)
    setComposeMessage('')
    try {
      const emailText = await callGenerateEmailApi(prompt)
      setManualBody(emailText)
      setAiEditPrompt('')
    } catch (error) {
      setComposeMessage(error?.message || 'Failed to generate email.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSend() {
    if (onSendEmail) {
      try {
        setIsSending(true)
        const encodedAttachments = await Promise.all(
          attachments.map(
            (a) =>
              new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve({ name: a.name, mimeType: a.mimeType, data: reader.result.split(',')[1] })
                reader.onerror = reject
                reader.readAsDataURL(a.file)
              })
          )
        )
        await onSendEmail({
          to,
          cc,
          subject,
          body: generatedBody || manualBody,
          draftId: isEditing ? initialData?.id : null,
          attachments: encodedAttachments,
        })
      } catch (error) {
        setComposeMessage(error?.message || 'Failed to send email.')
        setIsSending(false)
        return
      }
    }
    setIsSending(false)
    await handleClose({ saveDraft: false })
  }

  function handleEdit() {
    setStep('compose')
    setManualBody(generatedBody)
    setEditMode('manual')
  }

  async function handleClose(options = {}) {
    if (isClosing || isSending) return

    const draftBody = generatedBody || manualBody || aiPrompt
    const hasDraftContent = Boolean(to.trim() || subject.trim() || draftBody.trim())
    const shouldTrySave = options.saveDraft !== false && hasDraftContent && !draftSaveFailed

    setIsClosing(true)

    try {
      if (onClose) {
        const shouldClose = await onClose(
          shouldTrySave
            ? {
                to,
                subject,
                body: draftBody,
                draftId: isEditing ? initialData?.id : null,
              }
            : null
        )

        if (shouldClose === false) {
          setIsClosing(false)
          return
        }
      }

      setTo('')
      setCc('')
      setSubject('')
      setAiPrompt('')
      setAttachments([])
      setStep('compose')
      setGeneratedBody('')
      setEditMode('manual')
      setAiEditPrompt('')
      setManualBody('')
      setComposeMessage('')
      setIsSending(false)
      setIsClosing(false)
      setDraftSaveFailed(false)
    } catch (error) {
      setComposeMessage(error?.message || 'Failed to save Gmail draft.')
      setIsClosing(false)
      setDraftSaveFailed(true)
    }
  }

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Edit draft' : 'Compose email'}
    >
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${step === 'review' ? 'max-w-5xl' : 'max-w-4xl'} max-h-[94vh] flex flex-col overflow-hidden animate-[fadeScaleIn_0.15s_ease-out]`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-bold text-slate-900">
            {step === 'review' ? 'Review Email' : isEditing ? 'Edit Draft' : 'New Email'}
          </h3>
          <button
            onClick={() => void handleClose()}
            disabled={isClosing || isSending}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
              isClosing || isSending
                ? 'text-slate-300 cursor-not-allowed'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer'
            }`}
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {step === 'compose' ? (
          <div className="p-6 overflow-y-auto flex-1">
            <div className="space-y-3">
              <div>
                <label htmlFor="compose-to" className="block text-xs font-medium text-slate-500 mb-1">To</label>
                <input
                  id="compose-to"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              {!isEditing && (
                <div>
                  <label htmlFor="compose-cc" className="block text-xs font-medium text-slate-500 mb-1">CC</label>
                  <input
                    id="compose-cc"
                    type="email"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="cc@example.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              )}
              <div>
                <label htmlFor="compose-subject" className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
                <input
                  id="compose-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Edit mode toggle for draft editing */}
              {isEditing && (
                <div>
                  <div className="flex items-center gap-1 mb-2 bg-slate-100 rounded-lg p-0.5 w-fit">
                    <button
                      onClick={() => setEditMode('manual')}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                        editMode === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Edit manually
                    </button>
                    <button
                      onClick={() => setEditMode('ai')}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                        editMode === 'ai' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <SparklesIcon className="w-3.5 h-3.5" />
                      Let AI edit
                    </button>
                  </div>

                  {editMode === 'manual' ? (
                    <textarea
                      rows={16}
                      value={manualBody}
                      onChange={(e) => setManualBody(e.target.value)}
                      placeholder="Write your email body..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="bg-slate-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{manualBody}</pre>
                      </div>
                      <textarea
                        rows={2}
                        value={aiEditPrompt}
                        onChange={(e) => setAiEditPrompt(e.target.value)}
                        placeholder="e.g. Make it more formal and add a call to action..."
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      />
                      <button
                        onClick={handleAiRewrite}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-100 rounded-lg hover:bg-indigo-200 transition-colors cursor-pointer"
                      >
                        <SparklesIcon className="w-3.5 h-3.5" />
                        Generate from Prompt
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* AI prompt for new emails */}
              {!isEditing && (
                <div>
                  <label htmlFor="compose-prompt" className="block text-xs font-medium text-slate-500 mb-1">Tell the AI what to write</label>
                  <textarea
                    id="compose-prompt"
                    rows={12}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Write a follow-up email about the Q1 budget proposal..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
              )}

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-700">
                      <PaperclipIcon className="w-3 h-3" />
                      {a.name}
                      <button
                        onClick={() => handleRemoveAttachment(a.id)}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                        aria-label={'Remove ' + a.name}
                      >
                        <XIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <button
                ref={attachmentButtonRef}
                onClick={handleAttachFileClick}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <PaperclipIcon className="w-4 h-4" />
                Attach file
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleClose()}
                  disabled={isClosing || isSending}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
                    isClosing || isSending
                      ? 'text-slate-400 bg-slate-200 cursor-not-allowed'
                      : 'text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer'
                  }`}
                >
                  {isClosing ? 'Saving...' : 'Cancel'}
                </button>
                {isEditing && editMode === 'manual' && (
                  <button
                    onClick={async () => {
                      if (onSaveDraft) await onSaveDraft({ to, subject, body: manualBody })
                      await handleClose({ saveDraft: false })
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-200 rounded-xl hover:bg-slate-300 transition-colors cursor-pointer"
                  >
                    Save Draft
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate || isSending}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                    canGenerate && !isSending
                      ? 'text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer'
                      : 'text-slate-400 bg-slate-200 cursor-not-allowed'
                  }`}
                >
                  <SparklesIcon className="w-4 h-4" />
                  Generate with AI
                </button>
                {!isEditing && (
                  <button
                    onClick={handleGenerateAndSend}
                    disabled={!canGenerateInNewEmail || isSending}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                      canGenerateInNewEmail && !isSending
                        ? 'text-white bg-slate-700 hover:bg-slate-800 cursor-pointer'
                        : 'text-slate-400 bg-slate-200 cursor-not-allowed'
                    }`}
                  >
                    <SendIcon className="w-4 h-4" />
                    {isSending ? 'Sending...' : 'Generate & Send'}
                  </button>
                )}
              </div>
            </div>
            {!canGenerateInNewEmail && !isEditing && (
              <p className="mt-3 text-xs font-medium text-red-600">
                Enter a recipient in To and a prompt to enable Generate and Generate & Send.
              </p>
            )}
            {composeMessage && (
              <p className="mt-3 text-xs font-medium text-red-600">
                {composeMessage}
              </p>
            )}
          </div>
        ) : (
          /* Review step */
          <div className="p-6 overflow-y-auto flex-1">
            {to && (
              <div className="mb-3">
                <span className="text-xs font-medium text-slate-500">To: </span>
                <span className="text-sm text-slate-900">{to}</span>
                {cc && (
                  <>
                    <span className="text-xs font-medium text-slate-500 ml-3">CC: </span>
                    <span className="text-sm text-slate-900">{cc}</span>
                  </>
                )}
              </div>
            )}
            {subject && (
              <div className="mb-3">
                <span className="text-xs font-medium text-slate-500">Subject: </span>
                <span className="text-sm font-medium text-slate-900">{subject}</span>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-xs font-medium text-slate-600">
                    <PaperclipIcon className="w-3 h-3" />
                    {a.name}
                  </span>
                ))}
              </div>
            )}
            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <textarea
                rows={18}
                value={generatedBody}
                onChange={(e) => setGeneratedBody(e.target.value)}
                className="w-full text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed bg-transparent focus:outline-none resize-none"
              />
            </div>
            <div className="mb-5">
              <label htmlFor="review-regenerate-prompt" className="block text-xs font-medium text-slate-500 mb-1">
                Modify with a new prompt
              </label>
              <div className="flex items-start gap-2">
                <textarea
                  id="review-regenerate-prompt"
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Type a new prompt, then click Regenerate..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
                <button
                  disabled={!canGenerateInNewEmail}
                  onClick={() => {
                    if (!canGenerateInNewEmail) {
                      setComposeMessage('Enter a recipient in To and a prompt before regenerating.')
                      return
                    }
                    const body = buildGeneratedBodyFromPrompt(aiPrompt.trim())
                    setGeneratedBody(body)
                    setComposeMessage('')
                  }}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                    canGenerateInNewEmail
                      ? 'text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer'
                      : 'text-slate-400 bg-slate-200 cursor-not-allowed'
                  }`}
                >
                  <SparklesIcon className="w-4 h-4" />
                  Regenerate
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={handleEdit}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <PencilIcon className="w-4 h-4" />
                Edit
              </button>
              <button
                onClick={handleSend}
                disabled={isSending}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                  isSending
                    ? 'text-slate-400 bg-slate-200 cursor-not-allowed'
                    : 'text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer'
                }`}
              >
                <SendIcon className="w-4 h-4" />
                {isSending ? 'Sending...' : 'Send Email'}
              </button>
            </div>
            {composeMessage && (
              <p className="mt-3 text-xs font-medium text-red-600">{composeMessage}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// --- Main Dashboard ---
export default function EmailDashboard({ onSignOut, connectedAccountRows }) {
  const [gmailEmailState, setGmailEmails] = useState([])
  const [gmailDrafts, setGmailDrafts] = useState([])
  const [gmailSentEmails, setGmailSentEmails] = useState([])
  const [outlookEmailState, setOutlookEmails] = useState(() =>
    loadEmailsFromStorage(EMAIL_STORAGE_KEYS.outlook, [], { useFallbackWhenEmpty: false })
  )
  const [outlookDrafts, setOutlookDrafts] = useState([])
  const [outlookSentEmails, setOutlookSentEmails] = useState([])
  const [emailThreads, setEmailThreads] = useState({})
  const [selectedSentEmailId, setSelectedSentEmailId] = useState(null)
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [activePage, setActivePage] = useState('inbox')
  const [activeProvider, setActiveProvider] = useState('gmail')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSignOutModal, setShowSignOutModal] = useState(false)
  const [showComposeModal, setShowComposeModal] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileShowDetail, setMobileShowDetail] = useState(false)
  const [nextPageToken, setNextPageToken] = useState(null)
  const [gmailLoading, setGmailLoading] = useState(false)
  const [gmailLoadingMore, setGmailLoadingMore] = useState(false)
  const [gmailHasMore, setGmailHasMore] = useState(false)
  const [gmailInboxLoaded, setGmailInboxLoaded] = useState(false)
  const [gmailInboxFullyLoaded, setGmailInboxFullyLoaded] = useState(false)
  const [gmailDetailLoadingId, setGmailDetailLoadingId] = useState(null)

  // Outlook loading/pagination state
  const [outlookLoading, setOutlookLoading] = useState(false)
  const [outlookHasMore, setOutlookHasMore] = useState(false)
  const [outlookNextSkipToken, setOutlookNextSkipToken] = useState(null)
  const [outlookInboxLoaded, setOutlookInboxLoaded] = useState(false)
  const [outlookDetailLoadingId, setOutlookDetailLoadingId] = useState(null)

  // Settings state
  const [signature, setSignature] = useState('')
  const [useSignature, setUseSignature] = useState(true)
  const [connectedAccounts, setConnectedAccounts] = useState({ gmail: false, outlook: false })
  const [connectedEmails, setConnectedEmails] = useState({ gmail: '', outlook: '' })
  const [fetchedConnectedAccountRows, setFetchedConnectedAccountRows] = useState([])
  const [accountsLoading, setAccountsLoading] = useState(true)

  // Connect modal state
  const [connectModal, setConnectModal] = useState({ open: false, provider: null, fromInbox: false })
  const [disconnectModal, setDisconnectModal] = useState({ open: false, provider: null })
  const [directSendModal, setDirectSendModal] = useState({ open: false, payload: null })
  const [connectActionError, setConnectActionError] = useState('')

  // Draft editing
  const [editingDraft, setEditingDraft] = useState(null)
  const [deletingDraftId, setDeletingDraftId] = useState(null)

  // AI assistant state
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGeneratedEmail, setAiGeneratedEmail] = useState('')
  const [aiGeneratedMeta, setAiGeneratedMeta] = useState(null)
  const [aiActionMessage, setAiActionMessage] = useState('')
  const [aiActionTone, setAiActionTone] = useState('error')
  const [inboxReplyAttachments, setInboxReplyAttachments] = useState([])
  const gmailPageLoadRef = useRef(false)
  const gmailDetailLoadRef = useRef(new Set())
  const outlookPageLoadRef = useRef(false)
  const outlookDetailLoadRef = useRef(new Set())

  const currentEmails = activeProvider === 'gmail' ? gmailEmailState : outlookEmailState
  const currentDrafts = activeProvider === 'gmail' ? gmailDrafts : outlookDrafts
  const currentSentEmails = activeProvider === 'gmail' ? gmailSentEmails : outlookSentEmails
  const setCurrentEmails = activeProvider === 'gmail' ? setGmailEmails : setOutlookEmails
  const selectedEmail = currentEmails.find((e) => e.id === selectedEmailId) ?? null
  const selectedEmailDetailLoading =
    (activeProvider === 'gmail' && gmailDetailLoadingId === selectedEmail?.id) ||
    (activeProvider === 'outlook' && outlookDetailLoadingId === selectedEmail?.id)

  const effectiveConnectedAccountRows = Array.isArray(connectedAccountRows)
    ? connectedAccountRows
    : fetchedConnectedAccountRows

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(EMAIL_STORAGE_KEYS.gmail, JSON.stringify(gmailEmailState))
  }, [gmailEmailState])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(EMAIL_STORAGE_KEYS.outlook, JSON.stringify(outlookEmailState))
  }, [outlookEmailState])

  const getGoogleProviderToken = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return null

    const { data } = await supabase.auth.getSession()
    return data?.session?.provider_token || null
  }, [])

  const getSupabaseAccessToken = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  }, [])

  const createGmailDraft = useCallback(async ({ to, subject, body }) => {
    const token = await getGoogleProviderToken()
    if (!token) {
      throw new Error('Missing Gmail provider token.')
    }

    const response = await fetch('http://localhost:5001/api/emails/gmail/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, body }),
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.gmail_error || responseData.message || 'Failed to create Gmail draft.')
    }

    return responseData
  }, [getGoogleProviderToken])

  const updateGmailDraft = useCallback(async (draftId, { to, subject, body }) => {
    const token = await getGoogleProviderToken()
    if (!token) {
      throw new Error('Missing Gmail provider token.')
    }

    const response = await fetch(`http://localhost:5001/api/emails/gmail/drafts/${draftId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, body }),
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.gmail_error || responseData.message || 'Failed to update Gmail draft.')
    }

    return responseData
  }, [getGoogleProviderToken])

  const sendGmailDraft = useCallback(async (draftId) => {
    const token = await getGoogleProviderToken()
    if (!token) {
      throw new Error('Missing Gmail provider token.')
    }

    const response = await fetch(`http://localhost:5001/api/emails/gmail/drafts/${draftId}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.gmail_error || responseData.message || 'Failed to send Gmail draft.')
    }

    return responseData
  }, [getGoogleProviderToken])

  const deleteGmailDraft = useCallback(async (draftId) => {
    const token = await getGoogleProviderToken()
    if (!token) {
      throw new Error('Missing Gmail provider token.')
    }

    const response = await fetch(`http://localhost:5001/api/emails/gmail/drafts/${draftId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.gmail_error || responseData.message || 'Failed to delete Gmail draft.')
    }

    return responseData
  }, [getGoogleProviderToken])

  const fetchGmailEmailDetail = useCallback(async (emailId) => {
    if (!emailId || gmailDetailLoadRef.current.has(emailId)) return

    const token = await getGoogleProviderToken()
    if (!token) return

    gmailDetailLoadRef.current.add(emailId)
    setGmailDetailLoadingId(emailId)

    try {
      const response = await fetch(`http://localhost:5001/api/emails/gmail/${emailId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const responseData = await response.json()
      console.log('GMAIL API RESPONSE:', responseData)

      if (!response.ok) {
        console.error('Failed to load Gmail email detail:', responseData)
        return
      }

      const normalizedEmail = normalizeGmailEmail(responseData, 0)
      setGmailEmails((prev) => mergeEmailsById(prev, [normalizedEmail]))
    } catch (error) {
      console.error('Failed to load Gmail email detail:', error)
    } finally {
      gmailDetailLoadRef.current.delete(emailId)
      setGmailDetailLoadingId((currentId) => (currentId === emailId ? null : currentId))
    }
  }, [getGoogleProviderToken])

  const fetchGmailEmailPage = useCallback(async (token, pageToken = null) => {
    const params = new URLSearchParams({ maxResults: '25' })
    if (pageToken) {
      params.set('pageToken', pageToken)
    }

    const response = await fetch(`http://localhost:5001/api/emails/gmail?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.gmail_error || responseData.message || 'Failed to load Gmail emails.')
    }

    return responseData
  }, [])

  const loadGmailEmails = useCallback(async ({ pageToken = null, append = false, silent = false } = {}) => {
    if (gmailPageLoadRef.current) return
    if (!connectedAccounts.gmail) {
      setGmailEmails([])
      setNextPageToken(null)
      setGmailHasMore(false)
      setGmailInboxLoaded(false)
      setGmailInboxFullyLoaded(false)
      return
    }

    const token = await getGoogleProviderToken()
    if (!token) {
      setGmailEmails([])
      setNextPageToken(null)
      setGmailHasMore(false)
      setGmailInboxLoaded(false)
      setGmailInboxFullyLoaded(false)
      return
    }

    gmailPageLoadRef.current = true
    if (append) {
      setGmailLoadingMore(true)
    } else if (!silent) {
      setGmailLoading(true)
      setGmailInboxLoaded(false)
      setGmailInboxFullyLoaded(false)
      setNextPageToken(null)
      setGmailHasMore(false)
    }

    let loadedAnyPage = false
    let lastKnownNextPageToken = pageToken

    try {
      const responseData = await fetchGmailEmailPage(token, pageToken)
      const newEmails = Array.isArray(responseData.emails) ? responseData.emails : []
      const normalizedEmails = newEmails.map(normalizeGmailEmail)
      const nextToken = responseData.nextPageToken || null

      loadedAnyPage = true
      lastKnownNextPageToken = nextToken

      setGmailEmails((prev) => {
        if (append) {
          return mergeEmailsById(prev, normalizedEmails)
        }

        if (silent) {
          return mergeEmailsById(prev, normalizedEmails)
        }

        return normalizedEmails
      })
      setNextPageToken(nextToken)
      setGmailHasMore(Boolean(nextToken))
      setGmailInboxLoaded(true)
      setGmailInboxFullyLoaded(!nextToken)
    } catch (error) {
      console.error('Failed to load Gmail emails:', error)
      if (!append && !silent && !loadedAnyPage) {
        setGmailEmails([])
        setGmailInboxLoaded(false)
      }
      setNextPageToken(lastKnownNextPageToken || null)
      setGmailHasMore(Boolean(lastKnownNextPageToken))
      setGmailInboxFullyLoaded(false)
    } finally {
      gmailPageLoadRef.current = false
      setGmailLoading(false)
      setGmailLoadingMore(false)
    }
  }, [connectedAccounts.gmail, fetchGmailEmailPage, getGoogleProviderToken])

  const markGmailEmailStarState = useCallback(async (emailId, starred) => {
    const token = await getGoogleProviderToken()
    if (!token || !emailId) return

    try {
      const response = await fetch(`http://localhost:5001/api/emails/gmail/${emailId}/star`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ starred }),
      })
      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.gmail_error || responseData.message || 'Failed to sync Gmail star state.')
      }
    } catch (error) {
      console.error('Failed to sync Gmail star state:', error)
      // Revert optimistic update on failure
      setGmailEmails((prev) => prev.map((em) => (em.id === emailId ? { ...em, starred: !starred } : em)))
    }
  }, [getGoogleProviderToken])

  const markGmailEmailReadState = useCallback(async (emailId, read) => {
    const token = await getGoogleProviderToken()
    if (!token || !emailId) return

    try {
      const response = await fetch(`http://localhost:5001/api/emails/gmail/${emailId}/read`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ read }),
      })
      const responseData = await response.json()

      if (!response.ok) {
        if (responseData?.reconnectRequired) {
          setConnectActionError('Gmail read sync needs new permissions. Disconnect and reconnect your Google account.')
        }
        throw new Error(responseData.gmail_error || responseData.message || 'Failed to sync Gmail read state.')
      }
    } catch (error) {
      console.error('Failed to sync Gmail read state:', error)
      void loadGmailEmails({ silent: true })
    }
  }, [getGoogleProviderToken, loadGmailEmails])

  const getMicrosoftSupabaseToken = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  }, [])

  const handleDownloadAttachment = useCallback(async (emailId, attachmentId, filename, provider) => {
    try {
      if (provider === 'gmail') {
        const token = await getGoogleProviderToken()
        if (!token) return
        const res = await fetch(`http://localhost:5001/api/emails/gmail/${emailId}/attachments/${attachmentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const token = await getMicrosoftSupabaseToken()
        if (!token) return
        const res = await fetch(`http://localhost:5001/api/emails/outlook/${emailId}/attachments/${attachmentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('Failed to download attachment:', error)
    }
  }, [getGoogleProviderToken, getMicrosoftSupabaseToken])

  const createOutlookDraft = useCallback(async ({ to, subject, body }) => {
    const token = await getMicrosoftSupabaseToken()
    if (!token) throw new Error('Missing Outlook token.')

    const response = await fetch('http://localhost:5001/api/emails/outlook/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    })
    const responseData = await response.json()
    if (!response.ok) throw new Error(responseData.graph_error || responseData.message || 'Failed to create Outlook draft.')
    return responseData
  }, [getMicrosoftSupabaseToken])

  const updateOutlookDraft = useCallback(async (draftId, { to, subject, body }) => {
    const token = await getMicrosoftSupabaseToken()
    if (!token) throw new Error('Missing Outlook token.')

    const response = await fetch(`http://localhost:5001/api/emails/outlook/drafts/${draftId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    })
    const responseData = await response.json()
    if (!response.ok) throw new Error(responseData.graph_error || responseData.message || 'Failed to update Outlook draft.')
    return responseData
  }, [getMicrosoftSupabaseToken])

  const sendOutlookDraft = useCallback(async (draftId) => {
    const token = await getMicrosoftSupabaseToken()
    if (!token) throw new Error('Missing Outlook token.')

    const response = await fetch(`http://localhost:5001/api/emails/outlook/drafts/${draftId}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const responseData = await response.json()
    if (!response.ok) throw new Error(responseData.graph_error || responseData.message || 'Failed to send Outlook draft.')
    return responseData
  }, [getMicrosoftSupabaseToken])

  const deleteOutlookDraft = useCallback(async (draftId) => {
    const token = await getMicrosoftSupabaseToken()
    if (!token) throw new Error('Missing Outlook token.')

    const response = await fetch(`http://localhost:5001/api/emails/outlook/drafts/${draftId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const responseData = await response.json()
    if (!response.ok) throw new Error(responseData.graph_error || responseData.message || 'Failed to delete Outlook draft.')
    return responseData
  }, [getMicrosoftSupabaseToken])

  // conversationId -> email[] (ASC order, full conversation messages)
  const [outlookConversationMessages, setOutlookConversationMessages] = useState(new Map())
  // Set of conversationIds currently being fetched
  const [loadingConversationIds, setLoadingConversationIds] = useState(new Set())
  // Set of conversationIds where the fetch failed
  const [failedConversationIds, setFailedConversationIds] = useState(new Set())

  const fetchOutlookConversation = useCallback(async (conversationId) => {
    if (!conversationId) return
    const token = await getMicrosoftSupabaseToken()
    if (!token) return

    setLoadingConversationIds((prev) => new Set([...prev, conversationId]))
    setFailedConversationIds((prev) => { const next = new Set(prev); next.delete(conversationId); return next })

    try {
      const response = await fetch(
        `http://localhost:5001/api/emails/outlook/conversation/${encodeURIComponent(conversationId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await response.json()
      if (!response.ok) {
        console.error('Conversation fetch error:', data)
        setFailedConversationIds((prev) => new Set([...prev, conversationId]))
        return
      }

      const messages = Array.isArray(data.messages) ? data.messages.map(normalizeOutlookEmail) : []
      setOutlookConversationMessages((prev) => new Map([...prev, [conversationId, messages]]))
      setOutlookEmails((prev) => mergeEmailsById(prev, messages))
    } catch (error) {
      console.error('Conversation fetch error:', error)
      setFailedConversationIds((prev) => new Set([...prev, conversationId]))
    } finally {
      setLoadingConversationIds((prev) => {
        const next = new Set(prev)
        next.delete(conversationId)
        return next
      })
    }
  }, [getMicrosoftSupabaseToken])

  const loadOutlookEmails = useCallback(async ({ skipToken = null, append = false, silent = false } = {}) => {
    if (outlookPageLoadRef.current) return
    if (!connectedAccounts.outlook) {
      setOutlookEmails([])
      setOutlookNextSkipToken(null)
      setOutlookHasMore(false)
      setOutlookInboxLoaded(false)
      return
    }

    const token = await getMicrosoftSupabaseToken()
    if (!token) {
      setOutlookEmails([])
      setOutlookNextSkipToken(null)
      setOutlookHasMore(false)
      setOutlookInboxLoaded(false)
      return
    }

    outlookPageLoadRef.current = true
    if (!silent) {
      setOutlookLoading(true)
      if (!append) {
        setOutlookInboxLoaded(false)
        setOutlookNextSkipToken(null)
        setOutlookHasMore(false)
      }
    }

    try {
      const params = new URLSearchParams({ maxResults: '25' })
      if (skipToken) params.set('skipToken', skipToken)

      const response = await fetch(`http://localhost:5001/api/emails/outlook?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const responseData = await response.json()

      if (!response.ok) {
        console.error('Failed to load Outlook emails:', responseData)
        if (!append && !silent) {
          setOutlookEmails([])
          setOutlookInboxLoaded(false)
        }
        return
      }

      const newEmails = Array.isArray(responseData.emails) ? responseData.emails : []
      const normalizedEmails = newEmails.map(normalizeOutlookEmail)
      const nextSkipToken = responseData.nextSkipToken || null

      setOutlookEmails((prev) => {
        if (append || silent) return mergeEmailsById(prev, normalizedEmails)
        return normalizedEmails
      })
      setOutlookNextSkipToken(nextSkipToken)
      setOutlookHasMore(Boolean(nextSkipToken))
      setOutlookInboxLoaded(true)
    } catch (error) {
      console.error('Failed to load Outlook emails:', error)
      if (!append && !silent) {
        setOutlookEmails([])
        setOutlookInboxLoaded(false)
      }
    } finally {
      outlookPageLoadRef.current = false
      setOutlookLoading(false)
    }
  }, [connectedAccounts.outlook, getMicrosoftSupabaseToken])

  const fetchOutlookEmailDetail = useCallback(async (emailId) => {
    if (!emailId || outlookDetailLoadRef.current.has(emailId)) return

    const token = await getMicrosoftSupabaseToken()
    if (!token) return

    outlookDetailLoadRef.current.add(emailId)
    setOutlookDetailLoadingId(emailId)

    try {
      const response = await fetch(`http://localhost:5001/api/emails/outlook/${emailId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const responseData = await response.json()

      if (!response.ok) {
        console.error('Failed to load Outlook email detail:', responseData)
        return
      }

      const normalizedEmail = normalizeOutlookEmail(responseData)
      setOutlookEmails((prev) => mergeEmailsById(prev, [normalizedEmail]))
    } catch (error) {
      console.error('Failed to load Outlook email detail:', error)
    } finally {
      outlookDetailLoadRef.current.delete(emailId)
      setOutlookDetailLoadingId((currentId) => (currentId === emailId ? null : currentId))
    }
  }, [getMicrosoftSupabaseToken])

  const fetchSentEmailDetail = useCallback(async (emailId, provider) => {
    if (!emailId) return null
    try {
      if (provider === 'gmail') {
        const token = await getGoogleProviderToken()
        if (!token) return null
        const response = await fetch(`http://localhost:5001/api/emails/gmail/${emailId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) return null
        return await response.json()
      } else {
        const token = await getMicrosoftSupabaseToken()
        if (!token) return null
        const response = await fetch(`http://localhost:5001/api/emails/outlook/${emailId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) return null
        return await response.json()
      }
    } catch {
      return null
    }
  }, [getGoogleProviderToken, getMicrosoftSupabaseToken])

  const markOutlookEmailReadState = useCallback(async (emailId, read) => {
    const token = await getMicrosoftSupabaseToken()
    if (!token || !emailId) return

    try {
      const response = await fetch(`http://localhost:5001/api/emails/outlook/${emailId}/read`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ read }),
      })
      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.message || 'Failed to sync Outlook read state.')
      }
    } catch (error) {
      console.error('Failed to sync Outlook read state:', error)
      void loadOutlookEmails({ silent: true })
    }
  }, [getMicrosoftSupabaseToken, loadOutlookEmails])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setAccountsLoading(false)
      return
    }

    let cancelled = false

    async function loadConnectedAccounts() {
      setAccountsLoading(true)
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (cancelled) return

      if (userError) {
        console.error('Failed to get current user for connected accounts:', userError)
        setAccountsLoading(false)
        return
      }

      const userId = userData?.user?.id
      if (!userId) {
        setFetchedConnectedAccountRows([])
        setAccountsLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('connected_accounts')
        .select('provider,email')
        .eq('user_id', userId)
      if (cancelled) return

      if (error) {
        console.error('Failed to load connected accounts:', error)
        setAccountsLoading(false)
        return
      }

      setFetchedConnectedAccountRows(data ?? [])
      setAccountsLoading(false)
    }

    loadConnectedAccounts()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadGmailEmails()
  }, [loadGmailEmails])

  useEffect(() => {
    function refreshGmailSync() {
      if (gmailLoading || gmailLoadingMore) return
      if (document.visibilityState === 'visible') {
        void loadGmailEmails({ silent: true })
      }
    }

    const intervalId = window.setInterval(() => {
      if (gmailLoading || gmailLoadingMore) return
      if (activeProvider === 'gmail' && gmailHasMore) return
      if (document.visibilityState === 'visible') {
        void loadGmailEmails({ silent: true })
      }
    }, 5000)

    window.addEventListener('focus', refreshGmailSync)
    document.addEventListener('visibilitychange', refreshGmailSync)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshGmailSync)
      document.removeEventListener('visibilitychange', refreshGmailSync)
    }
  }, [activeProvider, gmailHasMore, gmailLoading, gmailLoadingMore, loadGmailEmails])

  useEffect(() => {
    loadOutlookEmails()
  }, [loadOutlookEmails])

  useEffect(() => {
    function refreshOutlookSync() {
      if (outlookLoading) return
      if (document.visibilityState === 'visible') {
        void loadOutlookEmails({ silent: true })
      }
    }

    const intervalId = window.setInterval(() => {
      if (outlookLoading) return
      if (activeProvider === 'outlook' && outlookHasMore) return
      if (document.visibilityState === 'visible') {
        void loadOutlookEmails({ silent: true })
      }
    }, 15000)

    window.addEventListener('focus', refreshOutlookSync)
    document.addEventListener('visibilitychange', refreshOutlookSync)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshOutlookSync)
      document.removeEventListener('visibilitychange', refreshOutlookSync)
    }
  }, [activeProvider, outlookHasMore, outlookLoading, loadOutlookEmails])

  useEffect(() => {
    let cancelled = false

    async function loadGmailSentEmails() {
      if (!connectedAccounts.gmail) {
        if (!cancelled) setGmailSentEmails([])
        return
      }

      const token = await getGoogleProviderToken()
      if (!token) {
        if (!cancelled) setGmailSentEmails([])
        return
      }

      try {
        const response = await fetch('http://localhost:5001/api/emails/gmail/sent', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        const responseData = await response.json()
        if (cancelled) return

        if (!response.ok) {
          console.error('Failed to load Gmail sent emails:', responseData)
          setGmailSentEmails([])
          return
        }

        setGmailSentEmails(
          Array.isArray(responseData.emails) ? responseData.emails.map(normalizeGmailSentEmail) : []
        )
      } catch (error) {
        console.error('Failed to load Gmail sent emails:', error)
        if (!cancelled) setGmailSentEmails([])
      }
    }

    loadGmailSentEmails()

    return () => {
      cancelled = true
    }
  }, [connectedAccounts.gmail, getGoogleProviderToken])

  useEffect(() => {
    let cancelled = false

    async function loadGmailDrafts() {
      if (!connectedAccounts.gmail) {
        if (!cancelled) setGmailDrafts([])
        return
      }

      const token = await getGoogleProviderToken()
      if (!token) {
        if (!cancelled) setGmailDrafts([])
        return
      }

      try {
        const response = await fetch('http://localhost:5001/api/emails/gmail/drafts', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        const responseData = await response.json()
        if (cancelled) return

        if (!response.ok) {
          console.error('Failed to load Gmail drafts:', responseData)
          setGmailDrafts([])
          return
        }

        setGmailDrafts(
          Array.isArray(responseData.drafts) ? responseData.drafts.map(normalizeGmailDraft) : []
        )
      } catch (error) {
        console.error('Failed to load Gmail drafts:', error)
        if (!cancelled) setGmailDrafts([])
      }
    }

    loadGmailDrafts()

    return () => {
      cancelled = true
    }
  }, [connectedAccounts.gmail, getGoogleProviderToken])

  useEffect(() => {
    let cancelled = false

    async function loadOutlookSentEmails() {
      if (!connectedAccounts.outlook) {
        if (!cancelled) setOutlookSentEmails([])
        return
      }

      const token = await getMicrosoftSupabaseToken()
      if (!token) {
        if (!cancelled) setOutlookSentEmails([])
        return
      }

      try {
        const response = await fetch('http://localhost:5001/api/emails/outlook/sent', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const responseData = await response.json()
        if (cancelled) return

        if (!response.ok) {
          console.error('Failed to load Outlook sent emails:', responseData)
          setOutlookSentEmails([])
          return
        }

        setOutlookSentEmails(
          Array.isArray(responseData.emails) ? responseData.emails.map(normalizeOutlookSentEmail) : []
        )
      } catch (error) {
        console.error('Failed to load Outlook sent emails:', error)
        if (!cancelled) setOutlookSentEmails([])
      }
    }

    loadOutlookSentEmails()

    return () => {
      cancelled = true
    }
  }, [connectedAccounts.outlook, getMicrosoftSupabaseToken])

  useEffect(() => {
    let cancelled = false

    async function loadOutlookDrafts() {
      if (!connectedAccounts.outlook) {
        if (!cancelled) setOutlookDrafts([])
        return
      }

      const token = await getMicrosoftSupabaseToken()
      if (!token) {
        if (!cancelled) setOutlookDrafts([])
        return
      }

      try {
        const response = await fetch('http://localhost:5001/api/emails/outlook/drafts', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const responseData = await response.json()
        if (cancelled) return

        if (!response.ok) {
          console.error('Failed to load Outlook drafts:', responseData)
          setOutlookDrafts([])
          return
        }

        setOutlookDrafts(
          Array.isArray(responseData.drafts) ? responseData.drafts.map(normalizeOutlookDraft) : []
        )
      } catch (error) {
        console.error('Failed to load Outlook drafts:', error)
        if (!cancelled) setOutlookDrafts([])
      }
    }

    loadOutlookDrafts()

    return () => {
      cancelled = true
    }
  }, [connectedAccounts.outlook, getMicrosoftSupabaseToken])

  useEffect(() => {
    const { nextConnectedAccounts, nextConnectedEmails } = getConnectedAccountState(effectiveConnectedAccountRows)
    setConnectedAccounts(nextConnectedAccounts)
    setConnectedEmails(nextConnectedEmails)
  }, [effectiveConnectedAccountRows])

  useEffect(() => {
    const { nextConnectedAccounts } = getConnectedAccountState(effectiveConnectedAccountRows)
    const hintedProvider = readAndClearProviderHint(false)

    if (hintedProvider && nextConnectedAccounts[hintedProvider]) {
      if (activeProvider !== hintedProvider) {
        setActiveProvider(hintedProvider)
      }
      readAndClearProviderHint(true)
      return
    }

    if (!nextConnectedAccounts[activeProvider]) {
      const fallbackProvider = getFirstConnectedProvider(nextConnectedAccounts)
      if (fallbackProvider && fallbackProvider !== activeProvider) {
        setActiveProvider(fallbackProvider)
      }
    }
  }, [effectiveConnectedAccountRows, activeProvider])

  useEffect(() => {
    if (currentSentEmails.length === 0) return

    const hasSelectedSentEmail = currentSentEmails.some((email) => email.id === selectedSentEmailId)
    if (!hasSelectedSentEmail) {
      setSelectedSentEmailId(currentSentEmails[0].id)
    }
  }, [currentSentEmails, selectedSentEmailId])

  useEffect(() => {
    const providerEmails = activeProvider === 'gmail' ? gmailEmailState : outlookEmailState

    const hasSelectedEmail = providerEmails.some((email) => email.id === selectedEmailId)
    if (!hasSelectedEmail) {
      setSelectedEmailId(null)
    }
  }, [activeProvider, connectedAccounts, gmailEmailState, outlookEmailState, selectedEmailId])

  function handleSelectEmail(id) {
    setSelectedEmailId(id)
    const selectedCurrentEmail = currentEmails.find((email) => email.id === id)
    setCurrentEmails((prev) => prev.map((e) => (e.id === id ? { ...e, read: true } : e)))
    setMobileShowDetail(true)
    setAiPrompt('')
    setAiGeneratedEmail('')
    setAiGeneratedMeta(null)
    setAiActionMessage('')
    setAiActionTone('error')

    if (activeProvider === 'gmail') {
      if (selectedCurrentEmail && !selectedCurrentEmail.read) {
        recentGmailReadOverrides.set(id, Date.now() + 10000)
        void markGmailEmailReadState(id, true)
      }
      const selectedGmailEmail = gmailEmailState.find((email) => email.id === id)
      if (selectedGmailEmail && !selectedGmailEmail.bodyLoaded) {
        void fetchGmailEmailDetail(id)
      }
    } else if (activeProvider === 'outlook') {
      if (selectedCurrentEmail && !selectedCurrentEmail.read) {
        void markOutlookEmailReadState(id, true)
      }
      const selectedOutlookEmail = outlookEmailState.find((email) => email.id === id)
      // Also fetch detail for emails that came from a conversation fetch (not originally in inbox state)
      if (!selectedOutlookEmail || !selectedOutlookEmail.bodyLoaded) {
        void fetchOutlookEmailDetail(id)
      }
    }
  }

  function handleToggleStar(id, e) {
    if (e) e.stopPropagation()
    const email = currentEmails.find((em) => em.id === id)
    if (!email) return
    const nowStarred = !email.starred
    setCurrentEmails((prev) => prev.map((em) => (em.id === id ? { ...em, starred: nowStarred } : em)))
    if (email.provider === 'gmail') {
      void markGmailEmailStarState(id, nowStarred)
    }
  }

  async function handleTogglePin(id, e) {
    if (e) e.stopPropagation()
    const email = outlookEmailState.find((em) => em.id === id)
    if (!email) return
    const nowPinned = !email.pinned
    // Optimistic update
    setOutlookEmails((prev) => prev.map((em) => (em.id === id ? { ...em, pinned: nowPinned } : em)))
    setOutlookConversationMessages((prev) => {
      const next = new Map(prev)
      for (const [cid, msgs] of next) {
        if (msgs.some((m) => m.id === id)) {
          next.set(cid, msgs.map((m) => m.id === id ? { ...m, pinned: nowPinned } : m))
        }
      }
      return next
    })
    // Sync to real Outlook — revert on failure
    try {
      const token = await getMicrosoftSupabaseToken()
      if (!token) throw new Error('No token')
      const res = await fetch(`http://localhost:5001/api/emails/outlook/${id}/flag`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged: nowPinned }),
      })
      if (!res.ok) throw new Error('Flag failed')
    } catch {
      setOutlookEmails((prev) => prev.map((em) => (em.id === id ? { ...em, pinned: !nowPinned } : em)))
    }
  }

  function getFilteredEmails() {
    let filtered = currentEmails
    if (activeFilter === 'unread') filtered = filtered.filter((e) => !e.read)
    if (activeFilter === 'starred') filtered = filtered.filter((e) => e.starred)
    if (activeFilter === 'pinned') filtered = filtered.filter((e) => e.pinned)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (e) =>
          e.sender.toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q) ||
          e.preview.toLowerCase().includes(q)
      )
    }
    return filtered
      .map((email, index) => ({ email, index }))
      .sort((a, b) => {
        const pinDifference = Number(Boolean(b.email.pinned)) - Number(Boolean(a.email.pinned))
        if (pinDifference !== 0) return pinDifference
        return a.index - b.index
      })
      .map(({ email }) => email)
  }

  function handleProviderSwitch(provider) {
    const providerEmails = provider === 'gmail' ? gmailEmailState : outlookEmailState

    if (!connectedAccounts[provider] && providerEmails.length === 0) {
      handleConnectStart(provider)
      return
    }

    setActiveProvider(provider)
    if (providerEmails.length > 0) {
      setSelectedEmailId(providerEmails[0].id)
    }
    setActiveFilter('all')
    setMobileShowDetail(false)
  }

  function handleGmailListScroll(event) {
    if (activeProvider !== 'gmail' || !gmailHasMore || gmailLoading || gmailLoadingMore || !nextPageToken) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    if (distanceFromBottom < 160) {
      void loadGmailEmails({ pageToken: nextPageToken, append: true })
    }
  }

  function handleLoadMoreGmailEmails() {
    if (activeProvider !== 'gmail' || !gmailHasMore || gmailLoading || gmailLoadingMore || !nextPageToken) {
      return
    }

    void loadGmailEmails({ pageToken: nextPageToken, append: true })
  }

  function handleOutlookListScroll(event) {
    if (activeProvider !== 'outlook' || !outlookHasMore || outlookLoading || !outlookNextSkipToken) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    if (distanceFromBottom < 160) {
      void loadOutlookEmails({ skipToken: outlookNextSkipToken, append: true })
    }
  }

  function handleLoadMoreOutlookEmails() {
    if (activeProvider !== 'outlook' || !outlookHasMore || outlookLoading || !outlookNextSkipToken) {
      return
    }

    void loadOutlookEmails({ skipToken: outlookNextSkipToken, append: true })
  }

  function handleConnect(provider, email) {
    const other = provider === 'gmail' ? 'outlook' : 'gmail'
    writeProviderTokenStatus(other, false)
    writeProviderTokenStatus(provider, true)
    setConnectedAccounts({ [provider]: true, [other]: false })
    setConnectedEmails((prev) => ({ ...prev, [provider]: email, [other]: '' }))
    if (connectModal.fromInbox) {
      setActiveProvider(provider)
      const providerEmails = provider === 'gmail' ? gmailEmailState : outlookEmailState
      if (providerEmails.length > 0) {
        setSelectedEmailId(providerEmails[0].id)
      }
      setActiveFilter('all')
      setMobileShowDetail(false)
    }
    setConnectModal({ open: false, provider: null, fromInbox: false })
  }

  async function handleConnectStart(provider) {
    setConnectActionError('')
    try {
      if (provider === 'gmail') {
        window.localStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'gmail')
        console.log('Setting oauth_provider_hint before Gmail connect click handler:', 'gmail')
        await startGoogleConnect()
      } else {
        window.localStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'outlook')
        console.log('Setting oauth_provider_hint before Outlook connect click handler:', 'outlook')
        await startMicrosoftConnect(true)
      }
    } catch (error) {
      setConnectActionError(error?.message || 'Could not start account connection.')
    }
  }

  function handleDisconnect(provider) {
    writeProviderTokenStatus(provider, false)
    setConnectedAccounts((prev) => ({ ...prev, [provider]: false }))
    setConnectedEmails((prev) => ({ ...prev, [provider]: '' }))
    if (activeProvider === provider) {
      const other = provider === 'gmail' ? 'outlook' : 'gmail'
      if (connectedAccounts[other]) {
        setActiveProvider(other)
        const otherEmails = other === 'gmail' ? gmailEmailState : outlookEmailState
        if (otherEmails.length > 0) setSelectedEmailId(otherEmails[0].id)
      }
    }
  }

  async function handleDeleteDraft(id) {
    if (activeProvider === 'gmail') {
      await deleteGmailDraft(id)
      setGmailDrafts((prev) => prev.filter((d) => d.id !== id))
    } else {
      await deleteOutlookDraft(id)
      setOutlookDrafts((prev) => prev.filter((d) => d.id !== id))
    }
    setDeletingDraftId(null)
  }

  async function handleSaveDraft(data) {
    if (!editingDraft) return

    if (activeProvider === 'gmail') {
      await updateGmailDraft(editingDraft.id, data)
      const nextDraft = {
        id: editingDraft.id,
        to: data.to || '',
        subject: data.subject || '(No Subject)',
        body: data.body || '',
        time: editingDraft.time,
      }
      setGmailDrafts((prev) => prev.map((d) => (d.id === editingDraft.id ? { ...d, ...nextDraft } : d)))
    } else {
      await updateOutlookDraft(editingDraft.id, data)
      const nextDraft = {
        id: editingDraft.id,
        to: data.to || '',
        subject: data.subject || '(No Subject)',
        body: data.body || '',
        time: editingDraft.time,
      }
      setOutlookDrafts((prev) => prev.map((d) => (d.id === editingDraft.id ? { ...d, ...nextDraft } : d)))
    }

    setEditingDraft(null)
  }

  async function handleSendEmail(data) {
    const now = new Date()
    const provider = data.provider || activeProvider
    const threadRootId = data.threadRootId || data.replyToId || null
    const sentEmail = {
      id: 's' + now.getTime(),
      to: (data.to || '').trim() || 'recipient@example.com',
      cc: (data.cc || '').trim(),
      subject: (data.subject || '').trim() || '(No Subject)',
      body: (data.body || '').trim(),
      provider,
      threadRootId,
      replyToId: data.replyToId || null,
      time: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      attachments: Array.isArray(data.attachments) && data.attachments.length > 0
        ? data.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType }))
        : [],
      hasAttachments: Array.isArray(data.attachments) && data.attachments.length > 0,
    }

    if (provider === 'gmail') {
      let responseData
      const hasAttachments = Array.isArray(data.attachments) && data.attachments.length > 0

      if (data.draftId && !hasAttachments) {
        await updateGmailDraft(data.draftId, {
          to: sentEmail.to,
          subject: sentEmail.subject,
          body: sentEmail.body,
        })
        responseData = await sendGmailDraft(data.draftId)
      } else {
        const token = await getGoogleProviderToken()
        if (!token) {
          throw new Error('Missing Gmail provider token.')
        }

        const response = await fetch('http://localhost:5001/api/emails/gmail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: sentEmail.to,
            subject: sentEmail.subject,
            body: sentEmail.body,
            replyToId: sentEmail.replyToId,
            attachments: Array.isArray(data.attachments) ? data.attachments : [],
          }),
        })
        responseData = await response.json()

        if (!response.ok) {
          throw new Error(responseData.gmail_error || responseData.message || 'Failed to send Gmail email.')
        }
      }

      const gmailSentEmail = {
        ...sentEmail,
        id: responseData.id || sentEmail.id,
      }

      setGmailSentEmails((prev) => [gmailSentEmail, ...prev])
      setSelectedSentEmailId(gmailSentEmail.id)
    } else {
      const token = await getMicrosoftSupabaseToken()
      if (!token) throw new Error('Missing Outlook token.')

      const hasAttachments = Array.isArray(data.attachments) && data.attachments.length > 0

      if (data.draftId && !hasAttachments) {
        await updateOutlookDraft(data.draftId, {
          to: sentEmail.to,
          subject: sentEmail.subject,
          body: sentEmail.body,
        })
        await sendOutlookDraft(data.draftId)
      } else {
        const response = await fetch('http://localhost:5001/api/emails/outlook/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: sentEmail.to,
            subject: sentEmail.subject,
            body: sentEmail.body,
            replyToId: sentEmail.replyToId,
            attachments: Array.isArray(data.attachments) ? data.attachments : [],
          }),
        })
        const responseData = await response.json()
        if (!response.ok) throw new Error(responseData.graph_error || responseData.message || 'Failed to send Outlook email.')
      }

      setOutlookSentEmails((prev) => [sentEmail, ...prev])
      setSelectedSentEmailId(sentEmail.id)

      // If replying in a thread, show the sent reply immediately in the conversation
      if (data.conversationId) {
        const optimisticReply = {
          id: sentEmail.id,
          sender: 'You',
          email: '',
          subject: sentEmail.subject,
          preview: sentEmail.body.substring(0, 150),
          bodyText: sentEmail.body,
          bodyHtml: '',
          time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          internalDate: now.getTime(),
          read: true,
          starred: false,
          avatar: 'Me',
          avatarColor: 'bg-indigo-500',
          provider: 'outlook',
          pinned: false,
          bodyLoaded: true,
          conversationId: data.conversationId,
        }
        setOutlookConversationMessages((prev) => {
          const existing = prev.get(data.conversationId) || []
          const withoutThis = existing.filter((e) => e.id !== optimisticReply.id)
          return new Map([...prev, [data.conversationId, [...withoutThis, optimisticReply]]])
        })
        setOutlookEmails((prev) => mergeEmailsById(prev, [optimisticReply]))
        // Re-fetch the full conversation after a moment to get the real sent email from Graph API
        setTimeout(() => { fetchOutlookConversation(data.conversationId) }, 2000)
      }
    }

    if (threadRootId) {
      const threadReply = {
        id: sentEmail.id,
        from: 'You',
        to: sentEmail.to,
        body: sentEmail.body,
        date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      }
      setEmailThreads((prev) => ({
        ...prev,
        [threadRootId]: [...(prev[threadRootId] || []), threadReply],
      }))
    }

    if (data.draftId) {
      if (provider === 'gmail') {
        setGmailDrafts((prev) => prev.filter((d) => d.id !== data.draftId))
      } else {
        setOutlookDrafts((prev) => prev.filter((d) => d.id !== data.draftId))
      }
    }

    return sentEmail
  }

  async function handleInboxGenerate() {
    if (!aiPrompt.trim()) {
      setAiActionMessage('Please type a prompt first before you can generate or send the email.')
      setAiActionTone('error')
      return
    }
    if (!selectedEmail) {
      setAiActionMessage('Please select an email first.')
      setAiActionTone('error')
      return
    }

    setAiActionMessage('')

    let emailText = ''
    try {
      const token = await getSupabaseAccessToken()
      const response = await fetch('http://localhost:5001/api/ai/generate-email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: selectedEmail.email,
          subject: `Re: ${selectedEmail.subject}`,
          userPrompt: aiPrompt.trim(),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to generate email.')
      emailText = data.emailText
      if (effectiveSignature) emailText = emailText + '\n\n' + effectiveSignature
    } catch (error) {
      setAiActionMessage(error?.message || 'Failed to generate email.')
      setAiActionTone('error')
      return
    }

    const payload = {
      to: selectedEmail.email,
      subject: `Re: ${selectedEmail.subject}`,
      body: emailText,
      provider: selectedEmail.provider || activeProvider,
      replyToId: selectedEmail.id,
      threadRootId: selectedEmail.threadRootId || selectedEmail.id,
      conversationId: selectedEmail.conversationId || null,
    }

    try {
      let draftId = null

      if (payload.provider === 'gmail') {
        const responseData = await createGmailDraft(payload)
        const createdDraft = normalizeGmailDraft({
          id: responseData.id,
          to: payload.to,
          subject: payload.subject,
          snippet: payload.body,
          date: '',
          internalDate: Date.now(),
        })
        draftId = responseData.id
        setGmailDrafts((prev) => [createdDraft, ...prev.filter((draft) => draft.id !== draftId)])
      } else {
        const responseData = await createOutlookDraft(payload)
        const createdDraft = normalizeOutlookDraft({
          id: responseData.id,
          to: payload.to,
          subject: payload.subject,
          snippet: payload.body,
          date: '',
          internalDate: Date.now(),
        })
        draftId = responseData.id
        setOutlookDrafts((prev) => [createdDraft, ...prev.filter((draft) => draft.id !== draftId)])
      }

      setAiGeneratedEmail(payload.body)
      setAiGeneratedMeta({
        to: payload.to,
        subject: payload.subject,
        provider: payload.provider,
        replyToId: payload.replyToId,
        threadRootId: payload.threadRootId,
        draftId,
      })
      setAiActionMessage('Email generated and saved to Drafts.')
      setAiActionTone('success')
    } catch (error) {
      setAiActionMessage(error?.message || 'Failed to save draft.')
      setAiActionTone('error')
    }
  }

  function handleReplySelectedEmail() {
    if (!selectedEmail) {
      setAiActionMessage('Please select an email first.')
      setAiActionTone('error')
      return
    }

    setAiGeneratedEmail('')
    setAiGeneratedMeta(null)
    setAiPrompt('')
    setAiActionMessage(`Reply mode enabled for "${selectedEmail.subject}". Tell the AI what you want to say, then click Generate.`)
    setAiActionTone('success')
  }

  function handleInboxPromptChange(value) {
    setAiPrompt(value)
    if (aiActionMessage) {
      setAiActionMessage('')
      setAiActionTone('error')
    }
  }

  function handleGeneratedEmailChange(value) {
    setAiGeneratedEmail(value)
    if (aiActionMessage) {
      setAiActionMessage('')
      setAiActionTone('error')
    }
  }

  async function encodeReplyAttachments() {
    return Promise.all(
      inboxReplyAttachments.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data: reader.result.split(',')[1] })
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
      )
    )
  }

  async function handleRequestDirectSend() {
    let payload = null

    if (aiGeneratedEmail.trim() && aiGeneratedMeta) {
      payload = {
        to: aiGeneratedMeta.to,
        subject: aiGeneratedMeta.subject,
        body: aiGeneratedEmail.trim(),
        provider: aiGeneratedMeta.provider,
        replyToId: aiGeneratedMeta.replyToId,
        threadRootId: aiGeneratedMeta.threadRootId,
        draftId: aiGeneratedMeta.draftId || null,
      }
    } else {
      const prompt = aiPrompt.trim()
      if (!prompt) {
        setAiActionMessage('Please type a prompt first before you can generate or send the email.')
        setAiActionTone('error')
        return
      }
      if (!selectedEmail) {
        setAiActionMessage('Please select an email first.')
        setAiActionTone('error')
        return
      }

      try {
        const token = await getSupabaseAccessToken()
        const response = await fetch('http://localhost:5001/api/ai/generate-email', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: selectedEmail.email,
            subject: `Re: ${selectedEmail.subject}`,
            userPrompt: prompt,
          }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to generate email.')
        let emailText = data.emailText
        if (effectiveSignature) emailText = emailText + '\n\n' + effectiveSignature
        payload = {
          to: selectedEmail.email,
          subject: `Re: ${selectedEmail.subject}`,
          body: emailText,
          provider: selectedEmail.provider || activeProvider,
          replyToId: selectedEmail.id,
          threadRootId: selectedEmail.threadRootId || selectedEmail.id,
          conversationId: selectedEmail.conversationId || null,
        }
      } catch (error) {
        setAiActionMessage(error?.message || 'Failed to generate email.')
        setAiActionTone('error')
        return
      }
    }

    if (!payload) {
      setAiActionMessage('Please type a prompt first before you can generate or send the email.')
      setAiActionTone('error')
      return
    }

    const encodedAttachments = await encodeReplyAttachments()
    payload.attachments = encodedAttachments

    setAiActionMessage('')

    setDirectSendModal({
      open: true,
      payload,
    })
  }

  async function handleSendGeneratedFromExpanded() {
    if (!aiGeneratedEmail.trim() || !aiGeneratedMeta) {
      setAiActionMessage('Generate an email first before sending.')
      setAiActionTone('error')
      return
    }

    try {
      const encodedAttachments = await encodeReplyAttachments()
      await handleSendEmail({
        to: aiGeneratedMeta.to,
        subject: aiGeneratedMeta.subject,
        body: aiGeneratedEmail.trim(),
        provider: aiGeneratedMeta.provider,
        replyToId: aiGeneratedMeta.replyToId,
        threadRootId: aiGeneratedMeta.threadRootId,
        draftId: aiGeneratedMeta.draftId || null,
        attachments: encodedAttachments,
      })

      setAiPrompt('')
      setAiGeneratedEmail('')
      setAiGeneratedMeta(null)
      setInboxReplyAttachments([])
      setAiActionMessage('Email sent.')
      setAiActionTone('success')
    } catch (error) {
      setAiActionMessage(error?.message || 'Failed to send email.')
      setAiActionTone('error')
    }
  }

  const filteredEmails = getFilteredEmails()
  const selectedThreadRootId = selectedEmail ? (selectedEmail.threadRootId || selectedEmail.id) : null
  const selectedThreadReplies = selectedThreadRootId ? (emailThreads[selectedThreadRootId] || []) : []

  const navItems = [
    { id: 'inbox', label: 'Inbox', icon: InboxIcon },
    { id: 'drafts', label: 'Drafts', icon: DraftIcon, badge: currentDrafts.length },
    { id: 'sent', label: 'Sent', icon: SentIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  const effectiveSignature = useSignature ? signature : ''

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-100 shrink-0">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <span className="text-lg font-bold text-slate-900">MailPilot</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activePage === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActivePage(item.id)
                  setMobileSidebarOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge > 0 && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Sign Out */}
        <div className="px-3 pb-4 mt-auto">
          <button
            onClick={() => setShowSignOutModal(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
          >
            <SignOutIcon className="w-5 h-5 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-4 px-4 lg:px-6 shrink-0">
          {/* Mobile menu */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
            </svg>
          </button>

          {/* Search */}
          <div className="flex-1 max-w-md relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search emails..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={() => {
                setEditingDraft(null)
                setShowComposeModal(true)
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer shadow-md shadow-indigo-200"
            >
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">New Email</span>
            </button>

            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
              U
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-hidden">
          {activePage === 'inbox' && (
            <InboxPage
              emails={filteredEmails}
              selectedEmail={selectedEmail}
              selectedEmailId={selectedEmailId}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              onSelectEmail={handleSelectEmail}
              onToggleStar={handleToggleStar}
              onTogglePin={handleTogglePin}
              onReplyEmail={handleReplySelectedEmail}
              threadReplies={selectedThreadReplies}
              aiPrompt={aiPrompt}
              setAiPrompt={handleInboxPromptChange}
              aiGeneratedEmail={aiGeneratedEmail}
              setAiGeneratedEmail={handleGeneratedEmailChange}
              aiActionMessage={aiActionMessage}
              aiActionTone={aiActionTone}
              signature={effectiveSignature}
              mobileShowDetail={mobileShowDetail}
              setMobileShowDetail={setMobileShowDetail}
              activeProvider={activeProvider}
              onProviderSwitch={handleProviderSwitch}
              connectedAccounts={connectedAccounts}
              accountsLoading={accountsLoading}
              gmailLoading={gmailLoading}
              gmailLoadingMore={gmailLoadingMore}
              gmailHasMore={gmailHasMore}
              gmailInboxLoaded={gmailInboxLoaded}
              gmailInboxFullyLoaded={gmailInboxFullyLoaded}
              outlookLoading={outlookLoading}
              outlookHasMore={outlookHasMore}
              outlookInboxLoaded={outlookInboxLoaded}
              selectedEmailDetailLoading={selectedEmailDetailLoading}
              onEmailListScroll={activeProvider === 'outlook' ? handleOutlookListScroll : handleGmailListScroll}
              onLoadMoreEmails={activeProvider === 'outlook' ? handleLoadMoreOutlookEmails : handleLoadMoreGmailEmails}
              onGenerateRequest={handleInboxGenerate}
              onDirectSendRequest={handleRequestDirectSend}
              onSendGeneratedRequest={handleSendGeneratedFromExpanded}
              onReplyAttachmentsChange={setInboxReplyAttachments}
              outlookConversationMessages={outlookConversationMessages}
              loadingConversationIds={loadingConversationIds}
              failedConversationIds={failedConversationIds}
              onLoadConversation={fetchOutlookConversation}
              onDownloadAttachment={handleDownloadAttachment}
            />
          )}
          {activePage === 'drafts' && (
            <DraftsPage
              drafts={currentDrafts}
              onDeleteRequest={(id) => setDeletingDraftId(id)}
              onEditRequest={(draft) => {
                setEditingDraft(draft)
                setShowComposeModal(true)
              }}
            />
          )}
          {activePage === 'settings' && (
            <SettingsPage
              signature={signature}
              setSignature={setSignature}
              useSignature={useSignature}
              setUseSignature={setUseSignature}
              connectedAccounts={connectedAccounts}
              connectedEmails={connectedEmails}
              onConnectRequest={handleConnectStart}
              onDisconnect={(provider) => setDisconnectModal({ open: true, provider })}
              connectActionError={connectActionError}
            />
          )}
          {activePage === 'sent' && (
            <SentPage
              gmailSentEmails={gmailSentEmails}
              outlookSentEmails={outlookSentEmails}
              selectedSentEmailId={selectedSentEmailId}
              onSelectSentEmail={setSelectedSentEmailId}
              gmailEmails={gmailEmailState}
              outlookEmails={outlookEmailState}
              defaultProvider={activeProvider}
              connectedAccounts={connectedAccounts}
              onFetchSentDetail={fetchSentEmailDetail}
              onDownloadAttachment={handleDownloadAttachment}
              outlookConversationMessages={outlookConversationMessages}
              loadingConversationIds={loadingConversationIds}
              onLoadConversation={fetchOutlookConversation}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <ConfirmModal
        isOpen={showSignOutModal}
        title="Sign out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign out"
        confirmClass="text-white bg-red-600 hover:bg-red-700"
        onCancel={() => setShowSignOutModal(false)}
        onConfirm={() => {
          setShowSignOutModal(false)
          onSignOut()
        }}
      />

      <ConfirmModal
        isOpen={!!deletingDraftId}
        title="Delete draft?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        confirmClass="text-white bg-red-600 hover:bg-red-700"
        onCancel={() => setDeletingDraftId(null)}
        onConfirm={() => handleDeleteDraft(deletingDraftId)}
      />

      <ConfirmModal
        isOpen={disconnectModal.open}
        title="Disconnect account?"
        message={`Are you sure you want to disconnect ${
          disconnectModal.provider === 'gmail' ? 'Gmail' : disconnectModal.provider === 'outlook' ? 'Outlook' : 'this account'
        }?`}
        confirmLabel="Disconnect"
        confirmClass="text-white bg-red-600 hover:bg-red-700"
        onCancel={() => setDisconnectModal({ open: false, provider: null })}
        onConfirm={() => {
          if (disconnectModal.provider) handleDisconnect(disconnectModal.provider)
          setDisconnectModal({ open: false, provider: null })
        }}
      />

      <ConfirmModal
        isOpen={directSendModal.open}
        title="Send directly?"
        message="Are you sure you want to send this email directly without reviewing or viewing it first?"
        confirmLabel="Send Now"
        confirmClass="text-white bg-indigo-600 hover:bg-indigo-700"
        onCancel={() => setDirectSendModal({ open: false, payload: null })}
        onConfirm={async () => {
          if (!directSendModal.payload) {
            setDirectSendModal({ open: false, payload: null })
            return
          }

          try {
            await handleSendEmail(directSendModal.payload)
            setAiPrompt('')
            setAiGeneratedEmail('')
            setAiGeneratedMeta(null)
            setInboxReplyAttachments([])
            setAiActionMessage('Email sent.')
            setAiActionTone('success')
          } catch (error) {
            setAiActionMessage(error?.message || 'Failed to send email.')
            setAiActionTone('error')
          }

          setDirectSendModal({ open: false, payload: null })
        }}
      />

      <ComposeModal
        isOpen={showComposeModal}
        onClose={async (draftData) => {
          const hasDraftContent = Boolean(
            draftData?.to?.trim() || draftData?.subject?.trim() || draftData?.body?.trim()
          )

          if (activeProvider === 'gmail') {
            if (hasDraftContent) {
              if (draftData?.draftId) {
                await updateGmailDraft(draftData.draftId, draftData)
                setGmailDrafts((prev) =>
                  prev.map((draft) =>
                    draft.id === draftData.draftId
                      ? {
                          ...draft,
                          to: draftData.to || '',
                          subject: draftData.subject || '(No Subject)',
                          body: draftData.body || '',
                        }
                      : draft
                  )
                )
              } else {
                const responseData = await createGmailDraft(draftData)
                const createdDraft = normalizeGmailDraft({
                  id: responseData.id,
                  to: draftData.to || '',
                  subject: draftData.subject || '(No Subject)',
                  snippet: draftData.body || '',
                  date: '',
                  internalDate: Date.now(),
                })
                setGmailDrafts((prev) => [createdDraft, ...prev])
              }
            }
          } else if (activeProvider === 'outlook') {
            if (hasDraftContent) {
              if (draftData?.draftId) {
                await updateOutlookDraft(draftData.draftId, draftData)
                setOutlookDrafts((prev) =>
                  prev.map((draft) =>
                    draft.id === draftData.draftId
                      ? {
                          ...draft,
                          to: draftData.to || '',
                          subject: draftData.subject || '(No Subject)',
                          body: draftData.body || '',
                        }
                      : draft
                  )
                )
              } else {
                const responseData = await createOutlookDraft(draftData)
                const createdDraft = normalizeOutlookDraft({
                  id: responseData.id,
                  to: draftData.to || '',
                  subject: draftData.subject || '(No Subject)',
                  snippet: draftData.body || '',
                  date: '',
                  internalDate: Date.now(),
                })
                setOutlookDrafts((prev) => [createdDraft, ...prev])
              }
              setAiActionMessage('Draft saved to Outlook.')
              setAiActionTone('success')
            }
          }

          setShowComposeModal(false)
          setEditingDraft(null)
          return true
        }}
        activeProvider={activeProvider}
        signature={signature}
        useSignature={useSignature}
        initialData={editingDraft}
        onSaveDraft={handleSaveDraft}
        onSendEmail={handleSendEmail}
      />

      <ConnectModal
        isOpen={connectModal.open}
        provider={connectModal.provider}
        onCancel={() => setConnectModal({ open: false, provider: null, fromInbox: false })}
        onConnect={(email) => handleConnect(connectModal.provider, email)}
      />

      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}


// --- Inbox Page ---
function InboxPage({
  emails,
  selectedEmail,
  selectedEmailId,
  activeFilter,
  setActiveFilter,
  onSelectEmail,
  onToggleStar,
  onTogglePin,
  onReplyEmail,
  threadReplies,
  aiPrompt,
  setAiPrompt,
  aiGeneratedEmail,
  setAiGeneratedEmail,
  aiActionMessage,
  aiActionTone,
  signature,
  mobileShowDetail,
  setMobileShowDetail,
  activeProvider,
  onProviderSwitch,
  connectedAccounts,
  accountsLoading,
  gmailLoading,
  gmailLoadingMore,
  gmailHasMore,
  gmailInboxLoaded,
  gmailInboxFullyLoaded,
  outlookLoading,
  outlookHasMore,
  outlookInboxLoaded,
  selectedEmailDetailLoading,
  onEmailListScroll,
  onLoadMoreEmails,
  onGenerateRequest,
  onDirectSendRequest,
  onSendGeneratedRequest,
  outlookConversationMessages,
  loadingConversationIds,
  failedConversationIds,
  onLoadConversation,
  onDownloadAttachment,
  onReplyAttachmentsChange,
}) {
  const [expandedThreadIds, setExpandedThreadIds] = useState(new Set())
  const [replyAttachments, setReplyAttachments] = useState([])
  const replyFileInputRef = useRef(null)

  useEffect(() => {
    onReplyAttachmentsChange?.(replyAttachments)
  }, [replyAttachments, onReplyAttachmentsChange])
  const emailListRef = useRef(null)
  const groupedEmails = activeProvider === 'gmail' ? groupEmailsByDate(emails) : []
  const outlookThreads = activeProvider === 'outlook' ? groupOutlookEmailsByThread(emails) : []
  const groupedOutlookThreads = activeProvider === 'outlook' ? groupOutlookThreadsByDate(outlookThreads) : []

  function toggleThread(conversationId, e) {
    e.stopPropagation()
    const isCurrentlyExpanded = expandedThreadIds.has(conversationId)
    // Trigger fetch before updating state (outside the state setter — no side effects in updaters)
    if (!isCurrentlyExpanded && !outlookConversationMessages?.has(conversationId) && !loadingConversationIds?.has(conversationId)) {
      onLoadConversation?.(conversationId)
    }
    setExpandedThreadIds((prev) => {
      const next = new Set(prev)
      if (next.has(conversationId)) {
        next.delete(conversationId)
      } else {
        next.add(conversationId)
      }
      return next
    })
  }
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    activeProvider === 'outlook'
      ? { id: 'pinned', label: 'Pinned' }
      : { id: 'starred', label: 'Starred' },
  ]

  useEffect(() => {
    if (activeProvider === 'gmail') {
      if (!gmailInboxLoaded || !gmailHasMore || gmailLoading || gmailLoadingMore) return
    } else if (activeProvider === 'outlook') {
      if (!outlookInboxLoaded || !outlookHasMore || outlookLoading) return
    } else {
      return
    }

    const listElement = emailListRef.current
    if (!listElement) return

    if (listElement.scrollHeight <= listElement.clientHeight + 24) {
      onLoadMoreEmails()
    }
  }, [activeProvider, emails.length, gmailHasMore, gmailInboxLoaded, gmailLoading, gmailLoadingMore, outlookHasMore, outlookInboxLoaded, outlookLoading, onLoadMoreEmails])

  return (
    <div className="flex h-full">
      {/* Email List - narrower */}
      <div
        className={`w-full md:w-80 lg:w-[340px] border-r border-slate-200 bg-white flex flex-col shrink-0 ${
          mobileShowDetail ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Provider toggle */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => onProviderSwitch('gmail')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeProvider === 'gmail'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
              </svg>
              Gmail
              {!connectedAccounts.gmail && (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
              )}
            </button>
            <button
              onClick={() => onProviderSwitch('outlook')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeProvider === 'outlook'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <svg className="w-4 h-4 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08L16.91 14l1.957-1.41v-2.534l-1.957 1.38L12.924 8.6V7.157h10.26c.226 0 .418.08.578.233.158.152.238.35.238.576v-.58zM14.078 5.07v14.64L0 17.488V3.293l14.078 1.778zm-2.89 4.252c-.533-.754-1.268-1.13-2.206-1.13-.918 0-1.654.386-2.2 1.16-.55.773-.822 1.772-.822 2.997 0 1.174.264 2.127.793 2.86.53.734 1.248 1.1 2.157 1.1.963 0 1.72-.37 2.27-1.113.55-.743.823-1.733.823-2.97 0-1.28-.272-2.284-.816-3.018v.114zm-1.16 5.057c-.267.477-.648.716-1.143.716-.486 0-.87-.245-1.15-.735-.28-.49-.42-1.14-.42-1.948 0-.84.14-1.506.42-1.998.282-.49.67-.737 1.168-.737.483 0 .863.24 1.142.72.278.48.418 1.142.418 1.985 0 .844-.145 1.52-.435 1.997z" />
              </svg>
              Outlook
              {!connectedAccounts.outlook && (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 px-4 py-3 border-b border-slate-100">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeFilter === f.id
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Email List */}
        <div
          ref={emailListRef}
          className="flex-1 overflow-y-auto"
          onScroll={onEmailListScroll}
        >
          {accountsLoading || (activeProvider === 'gmail' && gmailLoading) || (activeProvider === 'outlook' && outlookLoading) ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
              <p className="text-sm font-medium">Loading...</p>
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
              <InboxIcon className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">No emails found</p>
            </div>
          ) : activeProvider === 'gmail' ? (
            groupedEmails.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 bg-white/95 backdrop-blur border-b border-slate-100">
                  {group.label}
                </div>
                {group.emails.map((email) => (
                  <div
                    key={email.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open email from ${email.sender}: ${email.subject}`}
                    onClick={() => onSelectEmail(email.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectEmail(email.id)
                      }
                    }}
                    className={`w-full text-left px-4 py-3.5 border-b border-slate-50 flex items-start gap-3 transition-colors cursor-pointer ${
                      email.id === selectedEmailId
                        ? 'bg-indigo-50/70'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <GmailAvatar
                      sender={email.sender}
                      senderEmail={email.email}
                      initials={email.avatar}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {!email.read && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                        )}
                        <span className={`text-sm truncate ${email.read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                          {email.sender}
                        </span>
                        <span className="text-xs text-slate-400 ml-auto shrink-0">{email.time}</span>
                      </div>
                      <p className={`text-sm truncate mb-0.5 ${email.read ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>
                        {email.subject}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{email.preview}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleStar(email.id, e)
                      }}
                      className={`shrink-0 mt-1 cursor-pointer transition-colors ${
                        email.starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'
                      }`}
                      aria-label={email.starred ? 'Unstar' : 'Star'}
                    >
                      <StarIcon className="w-4 h-4" filled={email.starred} />
                    </button>
                  </div>
                ))}
              </div>
            ))
          ) : (
            groupedOutlookThreads.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 bg-white/95 backdrop-blur border-b border-slate-100">
                  {group.label}
                </div>
                {group.threads.map((thread) => {
              const isExpanded = expandedThreadIds.has(thread.conversationId)
              const isLoading = loadingConversationIds?.has(thread.conversationId)
              const isFailed = failedConversationIds?.has(thread.conversationId)
              const conversationMsgs = outlookConversationMessages?.get(thread.conversationId)
              // Use fetched full conversation if it has messages; otherwise show inbox emails we already have
              const expandedEmails = (conversationMsgs?.length > 0) ? conversationMsgs : thread.emails
              const threadCount = (conversationMsgs?.length > 0) ? conversationMsgs.length : thread.count
              const hasMultiple = thread.count > 1
              const latest = thread.latest

              return (
                <div key={thread.conversationId}>
                  {/* Thread header row */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Open email from ${latest.sender}: ${latest.subject}`}
                    onClick={() => onSelectEmail(latest.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectEmail(latest.id) }
                    }}
                    className={`w-full text-left px-4 py-3.5 border-b border-slate-50 flex items-start gap-2 transition-colors cursor-pointer ${
                      latest.id === selectedEmailId ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Chevron — only for threads with multiple messages */}
                    {hasMultiple ? (
                      <button
                        onClick={(e) => toggleThread(thread.conversationId, e)}
                        className="shrink-0 mt-1.5 text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label={isExpanded ? 'Collapse thread' : 'Expand thread'}
                      >
                        <ChevronRightIcon
                          className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      </button>
                    ) : (
                      <span className="shrink-0 w-3.5 mt-1.5" />
                    )}

                    <div className={`w-9 h-9 rounded-full ${latest.avatarColor} flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5`}>
                      {latest.avatar}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {!latest.read && <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />}
                        <span className={`text-sm truncate ${latest.read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                          {latest.sender}
                        </span>
                        {hasMultiple && (
                          <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5 shrink-0 leading-none">
                            {threadCount}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 ml-auto shrink-0">{latest.time}</span>
                      </div>
                      <p className={`text-sm truncate mb-0.5 ${latest.read ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>
                        {latest.subject}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{latest.preview}</p>
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); onTogglePin(latest.id, e) }}
                      className={`shrink-0 mt-1 cursor-pointer transition-colors ${latest.pinned ? 'text-indigo-500' : 'text-slate-300 hover:text-indigo-400'}`}
                      aria-label={latest.pinned ? 'Unpin' : 'Pin'}
                    >
                      <PinIcon className="w-4 h-4" filled={latest.pinned} />
                    </button>
                  </div>

                  {/* Expanded messages — immediate fallback to inbox emails, updates to full conversation when loaded */}
                  {isExpanded && (
                    <>
                      {isLoading && !conversationMsgs && (
                        <div className="pl-10 pr-4 py-2 border-b border-slate-50 border-l-2 border-l-indigo-100 text-xs text-slate-400 italic">
                          Loading full conversation…
                        </div>
                      )}
                      {isFailed && !isLoading && (
                        <div className="pl-10 pr-4 py-2 border-b border-slate-50 border-l-2 border-l-red-100 text-xs text-red-400 flex items-center gap-2">
                          <span>Failed to load full thread.</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); onLoadConversation?.(thread.conversationId) }}
                            className="underline font-medium hover:text-red-600 cursor-pointer"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      {expandedEmails.map((email) => (
                        <div
                          key={email.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open email from ${email.sender}`}
                          onClick={() => onSelectEmail(email.id)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectEmail(email.id) }
                          }}
                          className={`w-full text-left pl-10 pr-4 py-2.5 border-b border-slate-50 flex items-start gap-2.5 transition-colors cursor-pointer border-l-2 border-l-indigo-100 ${
                            email.id === selectedEmailId ? 'bg-indigo-50/70' : 'bg-slate-50/40 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-full ${email.avatarColor || 'bg-blue-500'} flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5`}>
                            {email.avatar || getAvatarFromSender(email.sender)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {!email.read && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />}
                              <span className={`text-sm truncate ${email.read ? 'font-medium text-slate-600' : 'font-bold text-slate-900'}`}>
                                {email.sender}
                              </span>
                              <span className="text-xs text-slate-400 ml-auto shrink-0">{email.time}</span>
                            </div>
                            <p className={`text-xs truncate ${email.read ? 'text-slate-500' : 'font-semibold text-slate-700'}`}>{email.subject}</p>
                            <p className="text-xs text-slate-400 truncate">{email.preview}</p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
                })}
              </div>
            ))
          )}
          {activeProvider === 'gmail' && gmailLoadingMore && (
            <div className="px-4 py-3 text-center text-xs font-medium text-slate-400">
              Loading more emails...
            </div>
          )}
          {activeProvider === 'gmail' && gmailInboxLoaded && gmailInboxFullyLoaded && !gmailHasMore && emails.length > 0 && (
            <div className="px-4 py-3 text-center text-xs font-medium text-slate-300">
              End of inbox
            </div>
          )}
          {activeProvider === 'outlook' && outlookInboxLoaded && !outlookHasMore && emails.length > 0 && (
            <div className="px-4 py-3 text-center text-xs font-medium text-slate-300">
              End of inbox
            </div>
          )}
        </div>
      </div>

      {/* Email Detail - wider */}
      <div
        className={`flex-1 flex flex-col bg-white min-w-0 ${
          mobileShowDetail ? 'flex' : 'hidden md:flex'
        }`}
      >
        {selectedEmail ? (
          <>
            {/* Detail Header */}
            <div className="px-6 py-5 border-b border-slate-100 shrink-0">
              <div className="flex items-start gap-4">
                <button
                  onClick={() => setMobileShowDetail(false)}
                  className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 mt-0.5"
                  aria-label="Back to list"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                {selectedEmail.provider === 'gmail' ? (
                  <GmailAvatar
                    sender={selectedEmail.sender}
                    senderEmail={selectedEmail.email}
                    initials={selectedEmail.avatar}
                    sizeClass="w-11 h-11"
                    textClass="text-sm"
                  />
                ) : (
                  <div className={`w-11 h-11 rounded-full ${selectedEmail.avatarColor} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
                    {selectedEmail.avatar}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-slate-900 truncate">{selectedEmail.sender}</h2>
                  <p className="text-sm font-medium text-slate-600 truncate">{selectedEmail.subject}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedEmail.email || selectedEmail.sender} &middot; {selectedEmail.date}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={onReplyEmail}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors cursor-pointer"
                    aria-label="Reply"
                    title="Reply"
                  >
                    <ReplyIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onTogglePin(selectedEmail.id)}
                    className={`w-8 h-8 inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                      selectedEmail.pinned ? 'text-indigo-500 bg-indigo-50' : 'text-slate-300 hover:text-indigo-500 hover:bg-indigo-50'
                    }`}
                    aria-label={selectedEmail.pinned ? 'Unpin' : 'Pin'}
                    title={selectedEmail.pinned ? 'Unpin email' : 'Pin email'}
                  >
                    <PinIcon className="w-4 h-4" filled={selectedEmail.pinned} />
                  </button>
                  {selectedEmail.provider !== 'outlook' && (
                    <button
                      onClick={() => onToggleStar(selectedEmail.id)}
                      className={`w-8 h-8 inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                        selectedEmail.starred ? 'text-amber-400 bg-amber-50' : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50'
                      }`}
                      aria-label={selectedEmail.starred ? 'Unstar' : 'Star'}
                      title={selectedEmail.starred ? 'Unstar email' : 'Star email'}
                    >
                      <StarIcon className="w-5 h-5" filled={selectedEmail.starred} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Scrollable area: email body + attachments + thread + AI assistant */}
            <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5">
              {selectedEmailDetailLoading ? (
                <p className="text-sm text-slate-400">Loading full message...</p>
              ) : selectedEmail.bodyHtml ? (
                <iframe
                  title={`Email content for ${selectedEmail.subject}`}
                  sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                  srcDoc={buildEmailHtmlDocument(selectedEmail.bodyHtml)}
                  className="w-full rounded-xl border border-slate-200 bg-white"
                  style={{ display: 'block' }}
                  onLoad={(e) => {
                    const iframe = e.target
                    const doc = iframe.contentDocument
                    if (!doc || !doc.body) return
                    const fit = () => {
                      // allow full height so scrollHeight is accurate
                      doc.body.style.overflow = 'visible'
                      if (doc.documentElement) doc.documentElement.style.overflow = 'visible'
                      const h = Math.max(doc.body.scrollHeight, doc.body.offsetHeight, 40)
                      iframe.style.height = h + 'px'
                      // hide iframe's own scrollbar — outer panel handles scrolling
                      doc.body.style.overflow = 'hidden'
                      if (doc.documentElement) doc.documentElement.style.overflow = 'hidden'
                    }
                    fit()
                    setTimeout(fit, 600)
                  }}
                />
              ) : (
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {selectedEmail.bodyText || selectedEmail.preview || 'No message content available.'}
                </pre>
              )}
              {(selectedEmail.attachments?.length > 0 || (selectedEmail.provider === 'outlook' && selectedEmail.hasAttachments && !selectedEmail.bodyLoaded)) && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
                    Attachments{selectedEmail.attachments?.length > 0 ? ` (${selectedEmail.attachments.length})` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(selectedEmail.attachments || []).map((att) => (
                      <button
                        key={att.attachmentId}
                        onClick={() => onDownloadAttachment?.(selectedEmail.id, att.attachmentId, att.filename, selectedEmail.provider)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-colors text-sm text-slate-700 cursor-pointer max-w-xs"
                      >
                        <AttachmentFileIcon mimeType={att.mimeType} />
                        <span className="truncate">{att.filename}</span>
                        {att.size > 0 && (
                          <span className="text-xs text-slate-400 shrink-0">{formatFileSize(att.size)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {threadReplies.length > 0 && (
                <div className="mt-6 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Thread Replies</p>
                  {threadReplies.map((reply) => (
                    <div
                      key={reply.id}
                      className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-indigo-700">{reply.from}</p>
                        <p className="text-xs text-slate-400">{reply.date} · {reply.time}</p>
                      </div>
                      <p className="text-xs text-slate-500 mb-2">To: {reply.to}</p>
                      <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                        {reply.body}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Assistant */}
            <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/70">
              <div className="flex items-center gap-2 mb-2">
                <SparklesIcon className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-semibold text-slate-600">AI Assistant</span>
              </div>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={2}
                placeholder={aiGeneratedEmail ? 'Send a new prompt to regenerate this email...' : 'Tell the AI how to reply...'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
              {aiGeneratedEmail && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-slate-600">Generated Email (Editable)</span>
                  </div>
                  <textarea
                    value={aiGeneratedEmail}
                    onChange={(e) => setAiGeneratedEmail(e.target.value)}
                    rows={12}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={onSendGeneratedRequest}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
                    >
                      <SendIcon className="w-4 h-4" />
                      Send
                    </button>
                  </div>
                </div>
              )}
              {replyAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {replyAttachments.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-100 rounded-full text-slate-600">
                      <PaperclipIcon className="w-3 h-3" />
                      {f.name}
                      <button
                        onClick={() => setReplyAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="ml-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                        aria-label="Remove attachment"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="file"
                multiple
                className="hidden"
                ref={replyFileInputRef}
                onChange={(e) => {
                  const files = Array.from(e.target.files || [])
                  if (files.length > 0) setReplyAttachments((prev) => [...prev, ...files])
                  e.target.value = ''
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <button
                  onClick={() => replyFileInputRef.current?.click()}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  aria-label="Attach file"
                >
                  <PaperclipIcon className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onGenerateRequest}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
                  >
                    <SparklesIcon className="w-3.5 h-3.5" />
                    Generate
                  </button>
                  <button
                    onClick={onDirectSendRequest}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 transition-colors cursor-pointer"
                  >
                    <SendIcon className="w-3.5 h-3.5" />
                    {'Generate & Send'}
                  </button>
                </div>
              </div>
              {aiActionMessage && (
                <p className={`mt-2 text-xs font-medium ${aiActionTone === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {aiActionMessage}
                </p>
              )}
            </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <InboxIcon className="w-12 h-12 mx-auto mb-3" />
              <p className="text-sm font-medium">Select an email to read</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// --- Drafts Page ---
function DraftsPage({ drafts, onDeleteRequest, onEditRequest }) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <DraftIcon className="w-6 h-6 text-slate-400" />
          <h2 className="text-xl font-bold text-slate-900">Drafts</h2>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {drafts.length}
          </span>
        </div>

        {drafts.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <DraftIcon className="w-10 h-10 mx-auto mb-3" />
            <p className="text-sm font-medium">No drafts yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-slate-500">To:</span>
                    <span className="text-sm font-medium text-slate-700 truncate">{draft.to}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 ml-3">{draft.time}</span>
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1">{draft.subject}</p>
                <p className="text-xs text-slate-500 line-clamp-2">{draft.body}</p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => onEditRequest(draft)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => onDeleteRequest(draft.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors cursor-pointer"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SentPage({ gmailSentEmails, outlookSentEmails, selectedSentEmailId, onSelectSentEmail, gmailEmails, outlookEmails, defaultProvider, connectedAccounts, onFetchSentDetail, onDownloadAttachment, outlookConversationMessages, loadingConversationIds, onLoadConversation }) {
  const [expandedSentThreadIds, setExpandedSentThreadIds] = useState(new Set())
  const [sentProvider, setSentProvider] = useState(() => {
    if (defaultProvider === 'outlook' && (outlookSentEmails?.length > 0 || connectedAccounts?.outlook)) return 'outlook'
    return 'gmail'
  })
  const [detailCache, setDetailCache] = useState({})
  const sentEmails = sentProvider === 'gmail' ? (gmailSentEmails || []) : (outlookSentEmails || [])
  const showToggle = connectedAccounts?.gmail && connectedAccounts?.outlook
  const selectedSentEmail = sentEmails.find((email) => email.id === selectedSentEmailId) || sentEmails[0]

  useEffect(() => {
    if (!selectedSentEmail || !onFetchSentDetail) return
    const id = selectedSentEmail.id
    // Only fetch if not a fresh in-session send (those have full body already)
    if (String(id).startsWith('s') || detailCache[id]) return
    onFetchSentDetail(id, selectedSentEmail.provider || sentProvider).then((data) => {
      if (data) setDetailCache((prev) => ({ ...prev, [id]: data }))
    })
  }, [selectedSentEmail?.id])
  const allProviderEmails = [...gmailEmails, ...outlookEmails]
  const relatedEmailId = selectedSentEmail ? (selectedSentEmail.replyToId || selectedSentEmail.threadRootId) : null
  const repliedToEmail = relatedEmailId
    ? allProviderEmails.find((email) => String(email.id) === String(relatedEmailId))
    : null

  const outlookSentThreads = sentProvider === 'outlook' ? groupOutlookEmailsByThread(sentEmails) : []

  function toggleSentThread(conversationId, e) {
    e.stopPropagation()
    const isCurrentlyExpanded = expandedSentThreadIds.has(conversationId)
    if (!isCurrentlyExpanded && !outlookConversationMessages?.has(conversationId) && !loadingConversationIds?.has(conversationId)) {
      onLoadConversation?.(conversationId)
    }
    setExpandedSentThreadIds((prev) => {
      const next = new Set(prev)
      if (next.has(conversationId)) {
        next.delete(conversationId)
      } else {
        next.add(conversationId)
      }
      return next
    })
  }

  return (
    <div className="h-full bg-white flex">
      <div className="w-full md:w-80 lg:w-[340px] border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <SentIcon className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-900">Sent</h2>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {sentEmails.length}
            </span>
          </div>
          {showToggle && (
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setSentProvider('gmail')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${sentProvider === 'gmail' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <span className="text-[10px]">M</span> Gmail
              </button>
              <button
                onClick={() => setSentProvider('outlook')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${sentProvider === 'outlook' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <span className="text-[10px]">⊞</span> Outlook
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sentEmails.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <SentIcon className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm font-medium">No sent emails yet</p>
            </div>
          ) : sentProvider === 'outlook' ? (
            outlookSentThreads.map((thread) => {
              const isExpanded = expandedSentThreadIds.has(thread.conversationId)
              const isLoading = loadingConversationIds?.has(thread.conversationId)
              const conversationMsgs = outlookConversationMessages?.get(thread.conversationId)
              const expandedEmails = (conversationMsgs?.length > 0) ? conversationMsgs : thread.emails
              const threadCount = (conversationMsgs?.length > 0) ? conversationMsgs.length : thread.count
              const hasMultiple = thread.count > 1
              const latest = thread.latest
              return (
                <div key={thread.conversationId}>
                  <div
                    className={`flex items-start gap-2 px-3.5 py-2.5 border-b border-slate-100 transition-colors cursor-pointer ${
                      selectedSentEmail && selectedSentEmail.id === latest.id ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSentEmail(latest.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectSentEmail(latest.id) } }}
                  >
                    {hasMultiple ? (
                      <button
                        onClick={(e) => toggleSentThread(thread.conversationId, e)}
                        className="shrink-0 mt-1 text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label={isExpanded ? 'Collapse thread' : 'Expand thread'}
                      >
                        <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                    ) : (
                      <span className="shrink-0 w-3.5 mt-1" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">To: {latest.to}</p>
                        <div className="flex items-center gap-1.5 shrink-0 ml-3">
                          {hasMultiple && (
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5 leading-none">
                              {threadCount}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">{latest.time}</span>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-700 truncate">{latest.subject}</p>
                      <p className="text-xs text-slate-500 truncate">{latest.body}</p>
                    </div>
                  </div>
                  {isExpanded && (
                    <>
                      {isLoading && !conversationMsgs && (
                        <div className="pl-8 pr-4 py-2 border-b border-slate-100 border-l-2 border-l-indigo-100 text-xs text-slate-400 italic">
                          Loading full conversation…
                        </div>
                      )}
                      {expandedEmails.map((email) => (
                        <div
                          key={email.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectSentEmail(email.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectSentEmail(email.id) } }}
                          className={`flex items-start gap-2.5 pl-8 pr-4 py-2.5 border-b border-slate-100 border-l-2 border-l-indigo-100 cursor-pointer transition-colors ${
                            selectedSentEmail && selectedSentEmail.id === email.id ? 'bg-indigo-50/70' : 'bg-slate-50/40 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-sm font-medium text-slate-700 truncate">{email.sender || `To: ${email.to}`}</span>
                              <span className="text-xs text-slate-400 shrink-0 ml-2">{email.time}</span>
                            </div>
                            {email.subject && <p className="text-xs font-medium text-slate-600 truncate">{email.subject}</p>}
                            <p className="text-xs text-slate-400 truncate">{email.preview || email.body}</p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
            })
          ) : (
            sentEmails.map((email) => (
              <button
                key={email.id}
                onClick={() => onSelectSentEmail(email.id)}
                className={`w-full text-left px-3.5 py-2.5 border-b border-slate-100 transition-colors cursor-pointer ${
                  selectedSentEmail && selectedSentEmail.id === email.id
                    ? 'bg-indigo-50/70'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">To: {email.to}</p>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    {(email.hasAttachments || email.attachments?.length > 0) && (
                      <PaperclipIcon className="w-3 h-3 text-slate-400" />
                    )}
                    <span className="text-xs text-slate-400">{email.time}</span>
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-700 truncate">{email.subject}</p>
                <p className="text-xs text-slate-500 truncate">{email.body}</p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedSentEmail ? (() => {
          const cached = detailCache[selectedSentEmail.id]
          const fullBody = cached?.bodyHtml || cached?.bodyText || selectedSentEmail.body
          const isHtml = Boolean(cached?.bodyHtml)
          const attachments = selectedSentEmail.attachments?.length > 0
            ? selectedSentEmail.attachments
            : (cached?.attachments || [])
          return (
          <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Sent Email</p>
              <p className="text-xs text-slate-500 mb-1">To: {selectedSentEmail.to}</p>
              <p className="text-sm font-semibold text-slate-900 mb-2">{selectedSentEmail.subject}</p>
              {isHtml ? (
                <div
                  className="text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: fullBody }}
                />
              ) : (
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {fullBody}
                </pre>
              )}
              {attachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att, i) => (
                      <button
                        key={i}
                        onClick={() => onDownloadAttachment?.(
                          selectedSentEmail.id,
                          att.attachmentId || att.id,
                          att.filename || att.name,
                          selectedSentEmail.provider || sentProvider
                        )}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs text-slate-700 transition-colors cursor-pointer"
                      >
                        <PaperclipIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[200px]">{att.filename || att.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {repliedToEmail && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Replied To</p>
                <p className="text-xs text-slate-500 mb-1">
                  From: {repliedToEmail.sender} ({repliedToEmail.email})
                </p>
                <p className="text-sm font-semibold text-slate-900 mb-2">{repliedToEmail.subject}</p>
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {repliedToEmail.body}
                </pre>
              </div>
            )}
          </div>
        )
        })() : (
          <div className="h-full flex items-center justify-center text-slate-400">
            <div className="text-center">
              <SentIcon className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm font-medium">Select a sent email to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// --- Settings Page ---
function SettingsPage({ signature, setSignature, useSignature, setUseSignature, connectedAccounts, connectedEmails, onConnectRequest, onDisconnect, connectActionError }) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <SettingsIcon className="w-6 h-6 text-slate-400" />
          <h2 className="text-xl font-bold text-slate-900">Settings</h2>
        </div>

        {/* Email Signature */}
        <div className="mb-10">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Email Signature</h3>
          <p className="text-xs text-slate-500 mb-3">This signature will be appended to your generated emails.</p>

          {/* Use signature toggle */}
          <label className="flex items-center gap-3 mb-3 cursor-pointer select-none">
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                useSignature ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'
              }`}
              onClick={() => setUseSignature(!useSignature)}
              role="checkbox"
              aria-checked={useSignature}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setUseSignature(!useSignature) } }}
            >
              {useSignature && <CheckIcon className="w-3.5 h-3.5 text-white" />}
            </div>
            <span className="text-sm font-medium text-slate-700" onClick={() => setUseSignature(!useSignature)}>
              Use signature
            </span>
          </label>

          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={4}
            placeholder={'e.g. Best regards,\nJohn Doe\nProduct Manager at Acme Corp'}
            disabled={!useSignature}
            className={`w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-opacity ${
              !useSignature ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
        </div>

        {/* Connected Accounts */}
        <div>
          <h3 className="text-sm font-bold text-slate-900 mb-1">Connected Accounts</h3>
          <p className="text-xs text-slate-500 mb-4">Manage your connected email accounts.</p>

          <div className="space-y-3">
            {/* Gmail */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Gmail</p>
                  <p className="text-xs text-slate-500">
                    {connectedAccounts.gmail && connectedEmails.gmail
                      ? connectedEmails.gmail
                      : 'Google account'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {connectedAccounts.gmail && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    Connected
                  </span>
                )}
                <button
                  onClick={() => connectedAccounts.gmail ? onDisconnect('gmail') : onConnectRequest('gmail')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    connectedAccounts.gmail
                      ? 'text-red-600 bg-red-50 hover:bg-red-100'
                      : 'text-white bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {connectedAccounts.gmail ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>

            {/* Outlook */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08L16.91 14l1.957-1.41v-2.534l-1.957 1.38L12.924 8.6V7.157h10.26c.226 0 .418.08.578.233.158.152.238.35.238.576v-.58zM14.078 5.07v14.64L0 17.488V3.293l14.078 1.778zm-2.89 4.252c-.533-.754-1.268-1.13-2.206-1.13-.918 0-1.654.386-2.2 1.16-.55.773-.822 1.772-.822 2.997 0 1.174.264 2.127.793 2.86.53.734 1.248 1.1 2.157 1.1.963 0 1.72-.37 2.27-1.113.55-.743.823-1.733.823-2.97 0-1.28-.272-2.284-.816-3.018v.114zm-1.16 5.057c-.267.477-.648.716-1.143.716-.486 0-.87-.245-1.15-.735-.28-.49-.42-1.14-.42-1.948 0-.84.14-1.506.42-1.998.282-.49.67-.737 1.168-.737.483 0 .863.24 1.142.72.278.48.418 1.142.418 1.985 0 .844-.145 1.52-.435 1.997z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Outlook</p>
                  <p className="text-xs text-slate-500">
                    {connectedAccounts.outlook && connectedEmails.outlook
                      ? connectedEmails.outlook
                      : 'Microsoft account'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {connectedAccounts.outlook && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    Connected
                  </span>
                )}
                <button
                  onClick={() => connectedAccounts.outlook ? onDisconnect('outlook') : onConnectRequest('outlook')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    connectedAccounts.outlook
                      ? 'text-red-600 bg-red-50 hover:bg-red-100'
                      : 'text-white bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {connectedAccounts.outlook ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          </div>
          {connectActionError && (
            <p className="mt-3 text-xs font-medium text-red-600">{connectActionError}</p>
          )}
        </div>
      </div>
    </div>
  )
}
