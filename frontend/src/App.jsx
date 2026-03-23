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
  return null
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

    if (error) {
      console.error('Failed to refresh connected accounts:', error)
      return
    }

    let rows = Array.isArray(data) ? data : []

    // If the user just completed a fresh OAuth login, only show that provider.
    // This prevents a previously-connected second provider from auto-connecting.
    // The flag is cleared when the user explicitly connects a second account.
    const lastLoginProvider = localStorage.getItem(LAST_LOGIN_PROVIDER_KEY)
    if (lastLoginProvider) {
      rows = rows.filter(
        (row) => normalizeConnectedProvider(row?.provider) === lastLoginProvider
      )
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

        const isPageRefresh = sessionStorage.getItem('mailpilot.session_active') === 'true'

        if (session?.access_token && currentPath === '/auth/callback') {
          sessionStorage.setItem('mailpilot.session_active', 'true')
          setAuthSession(session)
          setStoredToken(session.access_token)
          await refreshConnectedAccountRows(supabase, session.user?.id)
          if (!cancelled && typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/dashboard')
            setCurrentPage('dashboard')
          }
        } else if (session?.access_token && isPageRefresh) {
          // Page refresh — user was already logged in, restore their session
          setAuthSession(session)
          setStoredToken(session.access_token)
          await refreshConnectedAccountRows(supabase, session.user?.id)
          if (!cancelled && currentPath === '/dashboard') {
            setCurrentPage('dashboard')
          }
        } else if (session?.access_token) {
          // New tab/browser with a stale cached session — sign out so the
          // user always sees the login screen and must authenticate explicitly.
          await supabase.auth.signOut()
          if (!cancelled) {
            clearStoredToken()
            setAuthSession(null)
            setAuthUser(null)
            setConnectedAccountRows([])
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
      let shouldClearProviderIntent = Boolean(
        providerHint || startedAtRaw || localStorage.getItem(CONNECTING_PROVIDER_KEY)
      )
      try {
      if (!providerHint) {
        return
      }

      const startedAt = Number(startedAtRaw)
      if (!Number.isFinite(startedAt) || Date.now() - startedAt > CONNECTING_PROVIDER_MAX_AGE_MS) {
        return
      }

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
        return
      }
      const accountEmail = getBestIdentityEmail(user, providerHint)
      // Use authSession directly — it has the correct provider_token from the OAuth callback.
      // Calling getSession() again can return a stale or different provider's token.
      const accessToken = authSession?.provider_token
      const refreshToken = authSession?.provider_refresh_token

      console.log('Connected account upsert payload:', {
        userId: user.id,
        email: user.email,
        identities: user.identities,
        provider: providerHint,
      })

      writeProviderTokenStatus(providerHint, true)

      const { error: upsertError } = await supabase.from('connected_accounts').upsert(
        [
          {
            user_id: user.id,
            provider: providerHint,
            email: accountEmail,
            provider_access_token: accessToken,
            provider_refresh_token: refreshToken,
          },
        ],
        { onConflict: 'user_id,provider' }
      )

      if (cancelled) return
      if (upsertError) {
        console.error('Failed to upsert connected account:', upsertError)
        return
      }

      // On fresh login, remove all other providers from the DB so they don't
      // auto-connect. Each provider must be explicitly reconnected per session.
      const otherProviders = ['gmail', 'outlook'].filter(p => p !== providerHint)
      for (const other of otherProviders) {
        const { error: deleteError } = await supabase
          .from('connected_accounts')
          .delete()
          .eq('user_id', user.id)
          .eq('provider', other)
        if (deleteError) {
          console.error(`Failed to clear ${other} connected account on fresh login:`, deleteError)
        }
      }

      await refreshConnectedAccountRows(supabase, user.id)
      } finally {
        if (shouldClearProviderIntent) {
          clearConnectingProviderIntent()
        }
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
      // Clear the login-provider lock so both accounts show now that a second is connected.
      localStorage.removeItem(LAST_LOGIN_PROVIDER_KEY)
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
        // Clear the login-provider lock so both accounts show now that a second is connected.
        localStorage.removeItem(LAST_LOGIN_PROVIDER_KEY)
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
