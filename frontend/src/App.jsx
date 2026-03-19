import { useEffect, useState } from 'react'
import LandingPage from './LandingPage'
import EmailDashboard from './EmailDashboard'
import { apiFetch, clearStoredToken, setStoredToken } from './services/api'
import { getMe, login, logout } from './services/auth'
import { getSupabase } from './services/supabaseClient'

const CONNECTING_PROVIDER_KEY = 'connecting_provider'
const CONNECTING_PROVIDER_STARTED_AT_KEY = 'connecting_provider_started_at'
const PROVIDER_TOKEN_STATUS_KEY = 'mailpilot.provider_token_status'
const OAUTH_PROVIDER_HINT_STORAGE_KEY = 'mailpilot.oauth_provider_hint'
const CONNECTING_PROVIDER_MAX_AGE_MS = 15 * 60 * 1000

function getPageFromPath(pathname) {
  return pathname === '/dashboard' ? 'dashboard' : 'landing'
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

    const normalizedRows = (Array.isArray(data) ? data : [])
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
        const authCode =
          typeof window !== 'undefined'
            ? new URL(window.location.href).searchParams.get('code')
            : null

        if (authCode) {
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
        setAuthSession(session)

        if (session?.access_token) {
          setStoredToken(session.access_token)
          await refreshConnectedAccountRows(supabase, session.user?.id)
        } else {
          clearStoredToken()
          setAuthUser(null)
          setConnectedAccountRows([])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Supabase session sync failed:', error)
          clearStoredToken()
          setAuthSession(null)
          setAuthUser(null)
          setConnectedAccountRows([])
        }
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    }

    syncSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        setAuthSession(session ?? null)
        if (session?.access_token) {
          setStoredToken(session.access_token)
          refreshConnectedAccountRows(supabase, session.user?.id)
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
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const accessToken = session?.provider_token
      const refreshToken = session?.provider_refresh_token

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

  useEffect(() => {
    const controller = new AbortController()

    if (authSession?.access_token) {
      fetchAccounts(controller.signal)
    } else {
      setAccounts([])
    }

    return () => controller.abort()
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
    if (window.location.pathname !== '/dashboard') {
      window.history.pushState({}, '', '/dashboard')
    }
    setCurrentPage('dashboard')
  }

  async function handleSignOut() {
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
