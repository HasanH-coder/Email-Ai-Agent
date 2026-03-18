import { getSupabase } from './supabaseClient'

const OAUTH_PROVIDER_HINT_STORAGE_KEY = 'mailpilot.oauth_provider_hint'
const CONNECTING_PROVIDER_STARTED_AT_KEY = 'connecting_provider_started_at'

export async function startGoogleConnect() {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Missing Supabase env vars.')
  }

  localStorage.setItem('connecting_provider', 'google')
  localStorage.setItem('mailpilot.oauth_provider_hint', 'gmail')
  localStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'gmail')
  localStorage.setItem(CONNECTING_PROVIDER_STARTED_AT_KEY, String(Date.now()))
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'google')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/dashboard`,
      scopes: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to start Google OAuth.')
  }
}

export async function startMicrosoftConnect(redirectTo = `${window.location.origin}/dashboard`, userInitiated = false) {
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
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(OAUTH_PROVIDER_HINT_STORAGE_KEY, 'azure')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo,
      scopes: 'email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read',
      queryParams: {
        prompt: 'consent',
      },
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to start Microsoft OAuth.')
  }
}
