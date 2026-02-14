import { useState } from 'react'
import LandingPage from './LandingPage'
import EmailDashboard from './EmailDashboard'

export default function App() {
  const [currentPage, setCurrentPage] = useState('landing')

  function handleAuthSuccess() {
    setCurrentPage('dashboard')
  }

  function handleSignOut() {
    setCurrentPage('landing')
  }

  if (currentPage === 'dashboard') {
    return <EmailDashboard onSignOut={handleSignOut} />
  }

  return <LandingPage onAuthSuccess={handleAuthSuccess} />
}
