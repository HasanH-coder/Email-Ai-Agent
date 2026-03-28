import { useEffect, useState } from 'react'
import LandingPage from './LandingPage'
import EmailDashboard from './EmailDashboard'
import { apiFetch, clearStoredToken, setStoredToken } from './services/api'
import { getMe, login, logout } from './services/auth'
import { getSupabase } from './services/supabaseClient'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001'

const CONNECTING_PROVIDER_KEY = 'connecting_provider'
const CONNECTING_PROVIDER_STARTED_AT_KEY = 'connecting_provider_started_at'
const PROVIDER_TOKEN_STATUS_KEY = 'mailpilot.provider_token_status'
const OAUTH_PROVIDER_HINT_STORAGE_KEY = 'mailpilot.oauth_provider_hint'
const LAST_LOGIN_PROVIDER_KEY = 'mailpilot.last_login_provider'
const CONNECTING_PROVIDER_MAX_AGE_MS = 15 * 60 * 1000

function getPageFromPath(pathname) {
  if (pathname === '/dashboard') return 'dashboard'
  if (pathname === '/auth/callback') return 'auth-callback'
  return 'landing'
}

function readProviderTokenStatus() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PROVIDER_TOKEN_STATUS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeProviderTokenStatus(provider, hasToken) {
  if (typeof window === 'undefined') return
  const next = readProviderTokenStatus()
  const mailboxProvider =
    provider === 'google' || provider === 'gmail'
      ? 'gmail'
      : provider === 'azure' || provider === 'microsoft' || provider === 'outlook'
        ? 'outlook'
        : null
  if (!mailboxProvider) return
  next[mailboxProvider] = Boolean(hasToken)
  window.localStorage.setItem(PROVIDER_TOKEN_STATUS_KEY, JSON.stringify(next))
}

function normalizeConnectedProvider(provider) {
  if (provider === 'google' || provider === 'gmail') return 'gmail'
  if (provider === 'azure' || provider === 'microsoft' || provider === 'outlook') return 'outlook'
  if (provider === 'imap') return 'imap'
  return null
}

// LAST_LOGIN_PROVIDER_KEY stores a JSON array of providers the user has explicitly
// authenticated in this session (e.g. ["gmail"] or ["gmail","outlook"]).
// Legacy format: plain string — handled transparently by readActiveProviders().
function readActiveProviders() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LAST_LOGIN_PROVIDER_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (typeof parsed === 'string') return [parsed]
  } catch {
    // old plain-string value
    return [raw]
  }
  return null
}

function addActiveProvider(provider) {
  if (typeof window === 'undefined' || !provider) return
  const current = readActiveProviders() || []
  if (!current.includes(provider)) current.push(provider)
  window.localStorage.setItem(LAST_LOGIN_PROVIDER_KEY, JSON.stringify(current))
}

function getBestIdentityEmail(user, normalizedProvider) {
  if (!user) return null
  if (normalizedProvider === 'gmail') {
    const googleIdentity = user.identities?.find((identity) => identity?.provider === 'google')
    return (
      user.email ||
      googleIdentity?.identity_data?.email ||
      googleIdentity?.identity_data?.preferred_username ||
      user?.user_metadata?.email ||
      user?.user_metadata?.preferred_username ||
      null
    )
  }

  const microsoftIdentity = user.identities?.find(
    (identity) => identity?.provider === 'azure' || identity?.provider === 'microsoft'
  )
  return (
    microsoftIdentity?.identity_data?.email ||
    microsoftIdentity?.identity_data?.preferred_username ||
    user.email ||
    user?.user_metadata?.email ||
    user?.user_metadata?.preferred_username ||
    null
  )
}

function clearConnectingProviderIntent() {
  if (typeof window === 'undefined') return
  console.log(
    'Clearing oauth_provider_hint:',
    window.localStorage.getItem(OAUTH_PROVIDER_HINT_STORAGE_KEY)
  )
  window.localStorage.removeItem(CONNECTING_PROVIDER_KEY)
  window.localStorage.removeItem(CONNECTING_PROVIDER_STARTED_AT_KEY)
  window.localStorage.removeItem(OAUTH_PROVIDER_HINT_STORAGE_KEY)
}

function summarizeTokenPresence(token) {
  return token == null ? 'null' : 'present'
}

function logConnectedAccountTokenWrite({
  codePath,
  userId,
  provider,
  email,
  accessToken,
  refreshToken,
  accessTokenChanged,
  refreshTokenChanged,
}) {
  console.info('[connected_accounts] token write', {
    codePath,
    user_id: userId,
    provider,
    email: email || null,
    access_token_changed: accessTokenChanged,
    refresh_token_changed: refreshTokenChanged,
    next_access_token: summarizeTokenPresence(accessToken),
    next_refresh_token: summarizeTokenPresence(refreshToken),
  })
}

function ProtectedRoute({ canAccess, onDeny, children }) {
  useEffect(() => {
    if (!canAccess) onDeny()
  }, [canAccess, onDeny])

  if (!canAccess) return null
  return children
}

export default function App() {
  const [currentPage, setCurrentPage] = useState(() =>
    typeof window === 'undefined' ? 'landing' : getPageFromPath(window.location.pathname)
  )
  const [accounts, setAccounts] = useState([])
  const [authUser, setAuthUser] = useState(null)
  const [authSession, setAuthSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [connectedAccountRows, setConnectedAccountRows] = useState([])

  async function refreshConnectedAccountRows(supabase, userId) {
    if (!supabase || !userId) {
      setConnectedAccountRows([])
      return
    }

    const { data, error } = await supabase
      .from('connected_accounts')
      .select('provider,email')
      .eq('user_id', userId)
      .not('provider_access_token', 'is', null)

    if (error) {
      console.error('Failed to refresh connected accounts:', error)
      return
    }

    let rows = Array.isArray(data) ? data : []

    // Only show providers the user has explicitly authenticated in this session.
    // activeProviders is a JSON array (e.g. ["gmail"] or ["gmail","outlook"]).
    // IMAP always passes — it is added explicitly from Settings, not via OAuth.
    // When activeProviders is null (no key set), all rows pass (shouldn't happen
    // in normal flow, but safe as a fallback for edge cases like direct URL access).
    const activeProviders = readActiveProviders()
    if (activeProviders) {
      rows = rows.filter((row) => {
        const normalized = normalizeConnectedProvider(row?.provider)
        if (normalized === 'imap') return true
        return activeProviders.includes(normalized)
      })
    }

    const normalizedRows = rows
      .map((row) => {
        const provider = normalizeConnectedProvider(row?.provider)
        if (!provider) return null
        return { ...row, provider }
      })
      .filter(Boolean)

    setConnectedAccountRows(normalizedRows)
  }

  async function fetchAccounts(signal) {
    try {
      const data = await apiFetch('/api/accounts', {
        method: 'GET',
        signal,
      })
      setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch (error) {
      if (error.name === 'AbortError') return
      if (error.status === 401) {
        setAccounts([])
        return
      }
      console.error('Accounts request failed:', error)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    async function testBackendConnection() {
      try {
        const data = await apiFetch('/api/test', {
          method: 'GET',
          signal: controller.signal,
        })
        console.log('Backend test response:', data)
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error('Backend test request failed:', error)
      }
    }

    testBackendConnection()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setAuthReady(true)
      return
    }

    let cancelled = false

    async function syncSession() {
      try {
        const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
        const authCode =
          typeof window !== 'undefined'
            ? new URL(window.location.href).searchParams.get('code')
            : null

        if (currentPath === '/auth/callback' && authCode) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode)
          if (exchangeError) {
            console.error('Failed to exchange OAuth code for session:', exchangeError)
          }
        }

        const { data, error } = await supabase.auth.getSession()
        if (cancelled) return

        if (error) {
          clearStoredToken()
          setAuthSession(null)
          setAuthUser(null)
          return
        }

        const session = data?.session ?? null

        if (session?.access_token && currentPath === '/auth/callback') {
          sessionStorage.setItem('mailpilot.session_active', 'true')
          setAuthSession(session)
          setStoredToken(session.access_token)
          await refreshConnectedAccountRows(supabase, session.user?.id)
          if (!cancelled && typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/dashboard')
            setCurrentPage('dashboard')
          }
        } else if (session?.access_token) {
          // Restore any valid persisted Supabase session before deciding whether to redirect.
          setAuthSession(session)
          setStoredToken(session.access_token)
          await refreshConnectedAccountRows(supabase, session.user?.id)
          if (!cancelled && currentPath === '/dashboard') {
            setCurrentPage('dashboard')
          }
        } else if (currentPath === '/auth/callback' && authCode) {
          // The OAuth code was present but getSession() returned null — this happens when
          // Supabase's auto-detection (detectSessionInUrl) already consumed the PKCE
          // code_verifier before our manual exchangeCodeForSession call, causing a race
          // condition (common with Microsoft/Azure). Do NOT navigate to landing here;
          // the onAuthStateChange SIGNED_IN event will fire once the exchange completes
          // and will redirect to the dashboard.
        } else {
          setAuthSession(null)
          clearStoredToken()
          setAuthUser(null)
          setConnectedAccountRows([])
          if (!cancelled && typeof window !== 'undefined' && currentPath === '/auth/callback') {
            window.history.replaceState({}, '', '/')
            setCurrentPage('landing')
          }
        }
      } catch (error) {
        if (!cancelled) {
          clearStoredToken()
          setAuthSession(null)
          setAuthUser(null)
          setConnectedAccountRows([])
          if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
            window.history.replaceState({}, '', '/')
            setCurrentPage('landing')
          }
        }
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    }

    syncSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') {
        if (session?.access_token) {
          setAuthSession(session)
          setStoredToken(session.access_token)
        }
        return
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        sessionStorage.setItem('mailpilot.session_active', 'true')
        setAuthSession(session ?? null)
        if (session?.access_token) {
          setStoredToken(session.access_token)
          refreshConnectedAccountRows(supabase, session.user?.id)
          // If still on the callback page (e.g. Microsoft race condition where syncSession
          // couldn't get the session in time), navigate to the dashboard now.
          if (!cancelled && typeof window !== 'undefined') {
            const path = window.location.pathname
            if (path === '/auth/callback') {
              window.history.replaceState({}, '', '/dashboard')
              setCurrentPage('dashboard')
            }
          }
        }
        return
      }

      setAuthSession(session ?? null)
      if (session?.access_token) {
        setStoredToken(session.access_token)
        refreshConnectedAccountRows(supabase, session.user?.id)
      } else {
        clearStoredToken()
        setAuthUser(null)
        setConnectedAccountRows([])
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadAuthUser() {
      if (!authSession?.access_token) {
        setAuthUser(null)
        return
      }

      try {
        const user = await getMe()
        if (!cancelled) setAuthUser(user)
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load authenticated user:', error)
          setAuthUser(null)
        }
      }
    }

    loadAuthUser()
    return () => {
      cancelled = true
    }
  }, [authSession?.access_token])

  useEffect(() => {
    if (!authSession?.access_token) return

    const supabase = getSupabase()
    if (!supabase) return

    let cancelled = false

    async function saveConnectedAccount() {
      const providerHint = localStorage.getItem(OAUTH_PROVIDER_HINT_STORAGE_KEY)
      const startedAtRaw = localStorage.getItem(CONNECTING_PROVIDER_STARTED_AT_KEY)
      console.log('Reading oauth_provider_hint in saveConnectedAccount:', providerHint)

      if (!providerHint) return

      const startedAt = Number(startedAtRaw)
      if (!Number.isFinite(startedAt) || Date.now() - startedAt > CONNECTING_PROVIDER_MAX_AGE_MS) {
        // Intent too old — clean up stale keys and bail
        clearConnectingProviderIntent()
        return
      }

      try {
        const { data, error } = await supabase.auth.getUser()
        if (cancelled) return

        if (error) {
          console.error('Failed to get authenticated user:', error)
          return
        }

        const user = data?.user
        if (!user?.id) return

        if (providerHint !== 'gmail' && providerHint !== 'outlook') {
          console.error('Invalid oauth_provider_hint. Skipping connected_accounts upsert.', providerHint)
          clearConnectingProviderIntent()
          return
        }

        const accountEmail = getBestIdentityEmail(user, providerHint) || ''
        // Use authSession directly — it has the correct provider_token from the OAuth callback.
        // Calling getSession() again can return a stale or different provider's token.
        const accessToken = authSession?.provider_token
        const refreshToken = authSession?.provider_refresh_token

        if (!accessToken) {
          // provider_token not yet available — do NOT clear the hint so this effect
          // can retry on the next auth state change when the token arrives.
          // This is the key fix for first-time users where Supabase delivers SIGNED_IN
          // with provider_token=null and then fires a second event with the real token.
          console.info('[connected_accounts] skipping auth sync write without provider access token — will retry', {
            codePath: 'frontend.auth.saveConnectedAccount',
            user_id: user.id,
            provider: providerHint,
            email: accountEmail || null,
            next_access_token: summarizeTokenPresence(accessToken),
            next_refresh_token: summarizeTokenPresence(refreshToken),
          })
          return
        }

        console.log('Connected account upsert payload:', {
          userId: user.id,
          email: user.email,
          identities: user.identities,
          provider: providerHint,
        })

        writeProviderTokenStatus(providerHint, true)

        const payload = {
          user_id: user.id,
          provider: providerHint,
          email: accountEmail,
          provider_access_token: accessToken,
        }

        if (refreshToken) {
          payload.provider_refresh_token = refreshToken
        }

        logConnectedAccountTokenWrite({
          codePath: 'frontend.auth.saveConnectedAccount',
          userId: user.id,
          provider: providerHint,
          email: accountEmail,
          accessToken,
          refreshToken,
          accessTokenChanged: true,
          refreshTokenChanged: Boolean(refreshToken),
        })

        const { error: upsertError } = await supabase
          .from('connected_accounts')
          .upsert([payload], { onConflict: 'user_id,provider,email' })

        if (cancelled) return
        if (upsertError) {
          console.error('Failed to upsert connected account:', upsertError)
          return
        }

        await refreshConnectedAccountRows(supabase, user.id)
        // Only clear the intent after a successful save so that transient failures
        // (missing provider_token, network errors) can be retried automatically.
        clearConnectingProviderIntent()
      } catch (err) {
        console.error('saveConnectedAccount unexpected error:', err)
        // Do not clear intent — allow retry on next auth state change
      }
    }

    saveConnectedAccount()

    return () => {
      cancelled = true
    }
  }, [authSession])

  useEffect(() => {
    function handlePopState() {
      setCurrentPage(getPageFromPath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // When the tab regains focus, check if the Supabase session is still valid
  // and update the stored token if it was silently refreshed in the background.
  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    async function handleFocus() {
      const { data } = await supabase.auth.getSession()
      const session = data?.session
      if (session?.access_token) {
        setAuthSession(session)
        setStoredToken(session.access_token)
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    if (authSession?.access_token) {
      fetchAccounts(controller.signal)
    } else {
      setAccounts([])
    }

    return () => controller.abort()
  }, [authSession?.access_token])

  useEffect(() => {
    if (!authReady || !authSession?.access_token) return
    if (window.location.pathname === '/dashboard') {
      setCurrentPage('dashboard')
    }
    // Don't auto-redirect from the landing page — let users click through manually
  }, [authReady, authSession?.access_token])

  // After backend OAuth (Google callback redirects here with ?connected=gmail).
  // Also handles Microsoft code exchange (?code=...&state=...) since Azure is
  // configured to redirect back to the frontend dashboard URL.
  useEffect(() => {
    if (!authSession?.access_token) return
    const params = new URLSearchParams(window.location.search)

    const connected = params.get('connected')
    const code = params.get('code')
    const state = params.get('state')

    // Strip all OAuth params from URL immediately
    if (connected || code) {
      window.history.replaceState({}, '', '/dashboard')
    }

    if (connected) {
      // Google OAuth backend callback already stored the token — just refresh rows.
      // Add this provider to the active set so it appears alongside the login provider.
      const connectedProvider = normalizeConnectedProvider(connected)
      if (connectedProvider && connectedProvider !== 'imap') {
        addActiveProvider(connectedProvider)
      }
      const supabase = getSupabase()
      if (supabase) refreshConnectedAccountRows(supabase, authSession.user?.id)
      return
    }

    if (code && state) {
      // Microsoft redirected here with a code — exchange it via backend
      let provider = 'outlook'
      try {
        const decoded = JSON.parse(atob(state))
        provider = decoded.provider || 'outlook'
      } catch { /* ignore */ }

      if (provider === 'outlook') {
        // Add Outlook to the active set so it appears alongside the login provider.
        addActiveProvider('outlook')
        fetch(`${BACKEND_URL}/api/auth/microsoft/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authSession.access_token}`,
          },
          body: JSON.stringify({ code }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.ok) {
              const supabase = getSupabase()
              if (supabase) refreshConnectedAccountRows(supabase, authSession.user?.id)
            } else {
              console.error('Microsoft exchange failed:', data.message)
            }
          })
          .catch((err) => console.error('Microsoft exchange error:', err))
      }
    }
  }, [authSession?.access_token])

  async function handleDevLogin() {
    if (!authEmail.trim()) {
      setAuthError('Email is required.')
      return
    }

    setAuthLoading(true)
    setAuthError('')
    try {
      await login(authEmail.trim())
      setAuthError('OTP sent. Use the Sign In modal to verify your code.')
    } catch (error) {
      setAuthError(error.message || 'Login failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleDevLogout() {
    await logout()
    setAuthSession(null)
    setAuthUser(null)
    setAccounts([])
    setAuthError('')
  }

  function handleAuthSuccess(user, session = null) {
    if (user) {
      setAuthUser(user)
      setAuthError('')
    }
    if (session?.access_token) {
      setAuthSession(session)
      setStoredToken(session.access_token)
    }
    sessionStorage.setItem('mailpilot.session_active', 'true')
    if (window.location.pathname !== '/dashboard') {
      window.history.pushState({}, '', '/dashboard')
    }
    setCurrentPage('dashboard')
  }

  async function handleSignOut() {
    sessionStorage.removeItem('mailpilot.session_active')
    const { sessionCleared } = await logout()
    setAuthSession(null)
    setAuthUser(null)
    setAccounts([])

    if (!sessionCleared) {
      console.warn('Supabase session still exists after logout attempt.')
    }

    if (window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/')
    }
    setCurrentPage('landing')
  }

  function redirectToLanding() {
    if (window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/')
    }
    setCurrentPage('landing')
  }

  const isAuthenticated = Boolean(authSession?.access_token)

  if (!authReady) {
    return null
  }

  if (currentPage === 'auth-callback') {
    return null
  }

  if (currentPage === 'dashboard') {
    return (
      <ProtectedRoute canAccess={isAuthenticated} onDeny={redirectToLanding}>
        <EmailDashboard onSignOut={handleSignOut} connectedAccountRows={connectedAccountRows} />
      </ProtectedRoute>
    )
  }

  return (
    <LandingPage
      onAuthSuccess={handleAuthSuccess}
      accounts={accounts}
      showDevAuthPanel={import.meta.env.DEV}
      authUser={authUser}
      authEmail={authEmail}
      onAuthEmailChange={setAuthEmail}
      onDevLogin={handleDevLogin}
      onDevLogout={handleDevLogout}
      authLoading={authLoading}
      authError={authError}
    />
  )
}
