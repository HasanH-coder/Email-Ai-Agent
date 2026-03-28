import { getSupabase } from './supabaseClient'

const OAUTH_PROVIDER_HINT_STORAGE_KEY = 'mailpilot.oauth_provider_hint'
const CONNECTING_PROVIDER_STARTED_AT_KEY = 'connecting_provider_started_at'
const OAUTH_CALLBACK_PATH = '/auth/callback'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001'

function getOAuthRedirectUrl() {
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`
}

// Used for initial login (no existing session) — creates a new Supabase user
export async function startGoogleConnect() {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Missing Supabase env vars.')
  }

  localStorage.setItem('connecting_provider', 'google')
  localStorage.setItem('mailpilot.oauth_provider_hint', 'gmail')
  localStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'gmail')
  localStorage.setItem(CONNECTING_PROVIDER_STARTED_AT_KEY, String(Date.now()))
  localStorage.setItem('mailpilot.last_login_provider', JSON.stringify(['gmail']))
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'google')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getOAuthRedirectUrl(),
      scopes: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to start Google OAuth.')
  }
}

// Used for initial login (no existing session) — creates a new Supabase user
export async function startMicrosoftConnect(userInitiated = false) {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Missing Supabase env vars.')
  }
  if (!userInitiated) {
    throw new Error('Microsoft OAuth must be started by an explicit user action.')
  }

  localStorage.setItem('connecting_provider', 'azure')
  localStorage.setItem('mailpilot.oauth_provider_hint', 'outlook')
  localStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'outlook')
  localStorage.setItem(CONNECTING_PROVIDER_STARTED_AT_KEY, String(Date.now()))
  localStorage.setItem('mailpilot.last_login_provider', JSON.stringify(['outlook']))
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'outlook')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: getOAuthRedirectUrl(),
      scopes: [
        'openid', 'profile', 'email', 'offline_access',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.ReadWrite',
        'https://graph.microsoft.com/Mail.Send',
      ].join(' '),
      queryParams: { prompt: 'consent' },
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to start Microsoft OAuth.')
  }
}

// Used when already logged in — routes OAuth through the backend so the
// Supabase session never switches and tokens are stored under the existing user_id.
export async function connectOutlookViaBackend(supabaseToken) {
  const resp = await fetch(`${BACKEND_URL}/api/auth/microsoft/authorize`, {
    headers: { Authorization: `Bearer ${supabaseToken}` },
  })
  if (!resp.ok) {
    throw new Error('Failed to get Microsoft authorization URL.')
  }
  const { url } = await resp.json()
  window.location.href = url
}

export async function connectGmailViaBackend(supabaseToken) {
  const resp = await fetch(`${BACKEND_URL}/api/auth/google/authorize`, {
    headers: { Authorization: `Bearer ${supabaseToken}` },
  })
  if (!resp.ok) {
    throw new Error('Failed to get Google authorization URL.')
  }
  const { url } = await resp.json()
  window.location.href = url
}

// Test IMAP credentials against the server before saving.
// Throws with a user-facing message if the connection fails.
async function testImapConnection({ token, email, password, imapHost, imapPort }) {
  const response = await fetch(`${BACKEND_URL}/api/emails/imap/test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, imap_host: imapHost, imap_port: imapPort }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(
      data.message || 'Could not connect to IMAP server. Please check your credentials and server settings.'
    )
  }
}

// Save IMAP credentials to the connected_accounts table for the currently authenticated user.
// Tests the connection first — throws if credentials are invalid.
export async function connectImapAccount({ email, password, imapHost, imapPort, smtpHost, smtpPort }) {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Missing Supabase env vars.')

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData?.session) throw new Error('No authenticated session.')

  const token = sessionData.session.access_token
  const userId = sessionData.session.user?.id
  if (!userId) throw new Error('Could not determine user ID.')

  // Verify credentials are correct before persisting them
  await testImapConnection({ token, email, password, imapHost, imapPort })

  // Encode all credentials as JSON so provider_access_token is never null
  // (the connected_accounts query filters .not('provider_access_token', 'is', null))
  const credentialsJson = JSON.stringify({
    password,
    imap_host: imapHost,
    imap_port: Number(imapPort),
    smtp_host: smtpHost,
    smtp_port: Number(smtpPort),
  })

  const { error } = await supabase
    .from('connected_accounts')
    .upsert(
      [{ user_id: userId, provider: 'imap', email, provider_access_token: credentialsJson }],
      { onConflict: 'user_id,provider,email' }
    )

  if (error) throw new Error(error.message || 'Failed to save IMAP account.')

  return { email }
}
