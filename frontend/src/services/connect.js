import { getSupabase } from './supabaseClient'

export async function startGoogleConnect() {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Missing Supabase env vars.')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to start Google OAuth.')
  }
}

export async function startMicrosoftConnect() {
  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Missing Supabase env vars.')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: window.location.origin,
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to start Microsoft OAuth.')
  }
}
