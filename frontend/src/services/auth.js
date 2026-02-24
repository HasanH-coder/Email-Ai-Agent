import { apiFetch, clearStoredToken } from './api'
import { getSupabase } from './supabaseClient'

export async function login(email) {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Missing Supabase env vars.')
  }

  const { error } = await supabase.auth.signInWithOtp({ email })
  if (error) {
    throw new Error(error.message || 'Failed to send OTP email.')
  }
  return null
}

export async function getMe() {
  const payload = await apiFetch('/api/auth/me', {
    method: 'GET',
  })
  return payload.user
}

function clearAuthStorage() {
  clearStoredToken()

  if (typeof window === 'undefined') return

  const shouldClearKey = (key) => {
    if (!key) return false
    return key === 'auth_token' || key.startsWith('sb-') || key.startsWith('supabase.')
  }

  const localKeys = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    localKeys.push(window.localStorage.key(i))
  }
  for (const key of localKeys) {
    if (shouldClearKey(key)) {
      window.localStorage.removeItem(key)
    }
  }

  const sessionKeys = []
  for (let i = 0; i < window.sessionStorage.length; i += 1) {
    sessionKeys.push(window.sessionStorage.key(i))
  }
  for (const key of sessionKeys) {
    if (shouldClearKey(key)) {
      window.sessionStorage.removeItem(key)
    }
  }
}

export async function logout() {
  const supabase = getSupabase()
  let signOutError = null

  if (supabase) {
    try {
      const { error: globalError } = await supabase.auth.signOut({ scope: 'global' })
      if (globalError) {
        const { error } = await supabase.auth.signOut()
        if (error) signOutError = error
      }
    } catch (error) {
      signOutError = error
    }
  }

  clearAuthStorage()

  let session = null
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (!error) {
        session = data?.session ?? null
      }
    } catch {
      session = null
    }
  }

  return {
    sessionCleared: session === null,
    signOutError,
  }
}
