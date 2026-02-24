import { useEffect, useState } from 'react'
import LandingPage from './LandingPage'
import EmailDashboard from './EmailDashboard'
import { apiFetch, clearStoredToken, setStoredToken } from './services/api'
import { getMe, login, logout } from './services/auth'
import { getSupabase } from './services/supabaseClient'

function getPageFromPath(pathname) {
  return pathname === '/dashboard' ? 'dashboard' : 'landing'
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
        } else {
          clearStoredToken()
          setAuthUser(null)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Supabase session sync failed:', error)
          clearStoredToken()
          setAuthSession(null)
          setAuthUser(null)
        }
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    }

    syncSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session ?? null)
      if (session?.access_token) {
        setStoredToken(session.access_token)
      } else {
        clearStoredToken()
        setAuthUser(null)
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
    function handlePopState() {
      setCurrentPage(getPageFromPath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    if (authSession?.access_token && authUser) {
      fetchAccounts(controller.signal)
    } else {
      setAccounts([])
    }

    return () => controller.abort()
  }, [authSession?.access_token, authUser])

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

  function handleAuthSuccess(user) {
    if (user) {
      setAuthUser(user)
      setAuthError('')
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
        <EmailDashboard onSignOut={handleSignOut} />
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
