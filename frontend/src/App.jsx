import { useEffect, useState } from 'react'
import LandingPage from './LandingPage'
import EmailDashboard from './EmailDashboard'

export default function App() {
  const [currentPage, setCurrentPage] = useState('landing')
  const [accounts, setAccounts] = useState([])

  useEffect(() => {
    const controller = new AbortController()
    const baseUrl = import.meta.env.VITE_API_URL

    async function testBackendConnection() {
      try {
        const response = await fetch(`${baseUrl}/api/test`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const data = await response.json()
        console.log('Backend test response:', data)
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error('Backend test request failed:', error)
      }
    }

    async function fetchAccounts() {
      try {
        const response = await fetch(`${baseUrl}/api/accounts`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const data = await response.json()
        setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error('Accounts request failed:', error)
      }
    }

    if (baseUrl) {
      testBackendConnection()
      fetchAccounts()
    } else {
      console.error('Missing VITE_API_URL in frontend environment variables.')
    }

    return () => controller.abort()
  }, [])

  function handleAuthSuccess() {
    setCurrentPage('dashboard')
  }

  function handleSignOut() {
    setCurrentPage('landing')
  }

  if (currentPage === 'dashboard') {
    return <EmailDashboard onSignOut={handleSignOut} />
  }

  return <LandingPage onAuthSuccess={handleAuthSuccess} accounts={accounts} />
}
