import { useEffect, useState } from 'react'
import LandingPage from './LandingPage'
import EmailDashboard from './EmailDashboard'
import { apiFetch, getStoredToken } from './services/api'
import { getMe, login, logout } from './services/auth'

export default function App() {
  const [currentPage, setCurrentPage] = useState('landing')
  const [accounts, setAccounts] = useState([])
  const [authUser, setAuthUser] = useState(null)
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
    let cancelled = false

    async function restoreSession() {
      if (!getStoredToken()) return
      try {
        const user = await getMe()
        if (!cancelled) setAuthUser(user)
      } catch (error) {
        if (!cancelled) {
          logout()
          setAuthUser(null)
        }
      }
    }

    restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    if (authUser) {
      fetchAccounts(controller.signal)
    } else {
      setAccounts([])
    }

    return () => controller.abort()
  }, [authUser])

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

  function handleDevLogout() {
    logout()
    setAuthUser(null)
    setAuthError('')
  }

  function handleAuthSuccess(user) {
    if (user) {
      setAuthUser(user)
      setAuthError('')
    }
    setCurrentPage('dashboard')
  }

  function handleSignOut() {
    setCurrentPage('landing')
  }

  if (currentPage === 'dashboard') {
    return <EmailDashboard onSignOut={handleSignOut} />
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
