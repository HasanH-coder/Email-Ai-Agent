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

export function logout() {
  clearStoredToken()
  const supabase = getSupabase()
  if (supabase) {
    supabase.auth.signOut()
  }
}
