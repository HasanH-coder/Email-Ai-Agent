import { useState, useRef, useEffect, useCallback } from 'react'
import { getSupabase } from './services/supabaseClient'

export default function AuthModal({ isOpen, onClose, onAuthSuccess, defaultTab = 'signin' }) {
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [step, setStep] = useState('form')
  const [verifyEmail, setVerifyEmail] = useState('')
  const [otpValues, setOtpValues] = useState(['', '', '', '', '', ''])
  const [otpError, setOtpError] = useState('')
  const [otpInfo, setOtpInfo] = useState('')
  const [countdown, setCountdown] = useState(30)
  const [canResend, setCanResend] = useState(false)
  const otpRefs = useRef([])
  const backdropRef = useRef(null)

  // Sign In state
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')

  // Sign Up state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [signUpEmail, setSignUpEmail] = useState('')
  const [signUpPassword, setSignUpPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [signInError, setSignInError] = useState('')
  const [signUpError, setSignUpError] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')

  // Reset when defaultTab changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab)
      setStep('form')
      setOtpValues(['', '', '', '', '', ''])
      setOtpError('')
      setOtpInfo('')
      setCountdown(30)
      setCanResend(false)
      setAuthLoading(false)
      setSignInError('')
      setSignUpError('')
      setGoogleLoading(false)
      setGoogleError('')
    }
  }, [isOpen, defaultTab])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function closeIfAlreadyAuthenticated() {
      const supabase = getSupabase()
      if (!supabase) return

      try {
        const { data, error } = await supabase.auth.getSession()
        if (error || cancelled) return
        const user = data?.session?.user
        if (user) {
          onAuthSuccess(user)
          onClose()
        }
      } catch (error) {
        console.error('Session check failed:', error)
      }
    }

    closeIfAlreadyAuthenticated()
    return () => {
      cancelled = true
    }
  }, [isOpen, onAuthSuccess, onClose])

  // Countdown timer for resend
  useEffect(() => {
    if (step !== 'verify' || canResend) return
    if (countdown <= 0) {
      setCanResend(true)
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, step, canResend])

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  async function handleSignIn(e) {
    e.preventDefault()
    const supabase = getSupabase()
    if (!supabase) {
      setSignInError('Missing Supabase env vars.')
      return
    }

    if (!signInEmail.trim()) {
      setSignInError('Email is required.')
      return
    }
    if (!signInPassword) {
      setSignInError('Password is required.')
      return
    }

    setAuthLoading(true)
    setSignInError('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: signInEmail.trim(),
        password: signInPassword,
      })

      if (error) {
        const msg = (error.message || '').toLowerCase()

        if (msg.includes('invalid login credentials')) {
          setSignInError('Wrong email or password.')
        } else if (msg.includes('email not confirmed')) {
          setSignInError('Please verify your email first.')
        } else {
          setSignInError(error.message || 'Sign in failed.')
        }
        return
      }

      const accessToken = data?.session?.access_token
      const user = data?.user || data?.session?.user
      if (!accessToken || !user) {
        setSignInError('Sign in failed.')
        return
      }

      localStorage.setItem('auth_token', accessToken)
      onAuthSuccess(user)
      onClose()
    } catch (error) {
      setSignInError(error.message || 'Sign in failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleSignUp(e) {
    e.preventDefault()
    const supabase = getSupabase()
    if (!supabase) {
      setSignUpError('Missing Supabase env vars.')
      return
    }

    if (!signUpEmail.trim()) {
      setSignUpError('Email is required.')
      return
    }
    if (!signUpPassword) {
      setSignUpError('Password is required.')
      return
    }

    setAuthLoading(true)
    setSignUpError('')
    try {
      const normalizedEmail = signUpEmail.trim()
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: signUpPassword,
        options: {
          emailRedirectTo: window.location.origin,
        },
      })

      if (error) {
        const msg = (error.message || '').toLowerCase()

        if (msg.includes('user already registered')) {
          setSignUpError('Account already exists. Please Sign In.')
          return
        }

        setSignUpError(error.message || 'Sign up failed.')
        return
      }

      if (data?.user && data.user.identities && data.user.identities.length === 0) {
        setSignUpError('Account already exists. Please Sign In.')
        return
      }

      setVerifyEmail(normalizedEmail)
      setActiveTab('signup')
      setStep('verify')
      setCountdown(30)
      setCanResend(false)
      setOtpValues(['', '', '', '', '', ''])
      setOtpError('')
      setOtpInfo('Use the latest code only. Older codes stop working.')
    } catch (error) {
      setSignUpError(error.message || 'Sign up failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleGoogleAuth() {
    const supabase = getSupabase()
    if (!supabase) {
      setGoogleError('Missing Supabase env vars.')
      return
    }

    setGoogleLoading(true)
    setGoogleError('')
    setSignInError('')
    setSignUpError('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          queryParams: {
            prompt: 'select_account',
          },
        },
      })

      if (error) {
        console.error('Google OAuth sign-in error:', error)
        setGoogleError(error.message || 'Google OAuth failed.')
        setGoogleLoading(false)
      }
    } catch (error) {
      console.error('Google OAuth unexpected error:', error)
      setGoogleError(error.message || 'Google OAuth failed.')
      setGoogleLoading(false)
    }
  }

  function handleOtpChange(index, value) {
    if (!/^\d?$/.test(value)) return
    setOtpError('')
    const newValues = [...otpValues]
    newValues[index] = value
    setOtpValues(newValues)
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && !otpValues[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  function handleOtpPaste(e) {
    e.preventDefault()
    const pasteData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasteData.length === 6) {
      const newValues = pasteData.split('')
      setOtpValues(newValues)
      otpRefs.current[5]?.focus()
    }
  }

  async function handleVerify(e) {
    e.preventDefault()
    const supabase = getSupabase()
    if (!supabase) {
      setOtpError('Missing Supabase env vars.')
      return
    }

    const entered = otpValues.join('')
    if (entered.length !== 6) {
      setOtpError('Enter the 6-digit code from your email.')
      return
    }

    setAuthLoading(true)
    setOtpError('')

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: verifyEmail,
        token: entered,
        type: 'signup',
      })

      if (error) {
        setOtpError('Invalid or expired code. Use the latest code only.')
        return
      }

      const accessToken = data?.session?.access_token
      const user = data?.user || data?.session?.user

      if (!accessToken || !user) {
        setOtpError('Verification failed.')
        return
      }

      localStorage.setItem('auth_token', accessToken)
      onAuthSuccess(user)
      onClose()
    } catch (error) {
      setOtpError(error.message || 'Verification failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleResend() {
    if (!canResend) return
    const supabase = getSupabase()
    if (!supabase) {
      setOtpError('Missing Supabase env vars.')
      return
    }

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: verifyEmail,
      })
      if (error) {
        setOtpError(error.message || 'Failed to resend code. Please try again.')
        return
      }
      setCountdown(30)
      setCanResend(false)
      setOtpValues(['', '', '', '', '', ''])
      setOtpError('')
      setOtpInfo('Use the latest code only. Older codes stop working.')
    } catch (error) {
      setOtpError(error.message || 'Failed to resend code. Please try again.')
    }
  }

  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === backdropRef.current) onClose()
    },
    [onClose]
  )

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Authentication"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden animate-[fadeScaleIn_0.2s_ease-out]">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer z-10"
          aria-label="Close modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {step === 'form' ? (
          <div className="p-8">
            {/* Logo */}
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <span className="text-xl font-bold text-slate-900">MailPilot</span>
            </div>

            {/* Tabs */}
            <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
              <button
                onClick={() => {
                  setActiveTab('signin')
                  setSignUpError('')
                  setOtpError('')
                  setGoogleError('')
                }}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'signin'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  setActiveTab('signup')
                  setSignInError('')
                  setGoogleError('')
                }}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'signup'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Sign Up
              </button>
            </div>

            {/* Sign In Form */}
            {activeTab === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label htmlFor="signin-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Email
                  </label>
                  <input
                    id="signin-email"
                    type="email"
                    required
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label htmlFor="signin-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    id="signin-password"
                    type="password"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-200 ${
                    authLoading
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer'
                  }`}
                >
                  {authLoading ? 'Signing In...' : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={authLoading || googleLoading}
                  className={`w-full py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    authLoading || googleLoading
                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 cursor-pointer'
                  }`}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6A9.4 9.4 0 0 0 2.6 12 9.4 9.4 0 0 0 12 21.4c5.4 0 9-3.8 9-9.1 0-.6-.1-1-.2-1.5H12Z" />
                    <path fill="#34A853" d="M3.7 7.3l3.2 2.3C7.7 8 9.7 6.5 12 6.5c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6c-3.7 0-7 2.1-8.3 4.7Z" />
                    <path fill="#4A90E2" d="M12 21.4c2.5 0 4.7-.8 6.2-2.3l-2.9-2.4c-.8.6-1.9 1.2-3.3 1.2-3.9 0-5.3-2.6-5.5-3.9L3.3 16.5c1.3 2.6 4.6 4.9 8.7 4.9Z" />
                    <path fill="#FBBC05" d="M3.3 16.5A9.3 9.3 0 0 1 2.6 12c0-1.5.4-3 .9-4.3l3.4 2.5c-.2.5-.3 1.1-.3 1.8 0 .6.1 1.3.3 1.8l-3.6 2.7Z" />
                  </svg>
                  {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
                </button>
                {googleError && <p className="text-sm text-red-600 text-center">{googleError}</p>}
                {signInError && <p className="text-sm text-red-600 text-center">{signInError}</p>}
                <p className="text-center text-sm text-slate-500">
                  {"Don't have an account? "}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('signup')
                      setSignInError('')
                      setGoogleError('')
                    }}
                    className="text-indigo-600 font-medium hover:text-indigo-700 cursor-pointer"
                  >
                    Sign Up
                  </button>
                </p>
              </form>
            )}

            {/* Sign Up Form */}
            {activeTab === 'signup' && (
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="first-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                      First Name
                    </label>
                    <input
                    id="first-name"
                    type="text"
                    value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jane"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                    />
                  </div>
                  <div className="flex-1">
                    <label htmlFor="last-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                      Last Name
                    </label>
                    <input
                    id="last-name"
                    type="text"
                    value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Doe"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="signup-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Email
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label htmlFor="signup-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                    placeholder="Create a password"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-200 ${
                    authLoading
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer'
                  }`}
                >
                  {authLoading ? 'Creating Account...' : 'Create Account'}
                </button>
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={authLoading || googleLoading}
                  className={`w-full py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    authLoading || googleLoading
                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 cursor-pointer'
                  }`}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6A9.4 9.4 0 0 0 2.6 12 9.4 9.4 0 0 0 12 21.4c5.4 0 9-3.8 9-9.1 0-.6-.1-1-.2-1.5H12Z" />
                    <path fill="#34A853" d="M3.7 7.3l3.2 2.3C7.7 8 9.7 6.5 12 6.5c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6c-3.7 0-7 2.1-8.3 4.7Z" />
                    <path fill="#4A90E2" d="M12 21.4c2.5 0 4.7-.8 6.2-2.3l-2.9-2.4c-.8.6-1.9 1.2-3.3 1.2-3.9 0-5.3-2.6-5.5-3.9L3.3 16.5c1.3 2.6 4.6 4.9 8.7 4.9Z" />
                    <path fill="#FBBC05" d="M3.3 16.5A9.3 9.3 0 0 1 2.6 12c0-1.5.4-3 .9-4.3l3.4 2.5c-.2.5-.3 1.1-.3 1.8 0 .6.1 1.3.3 1.8l-3.6 2.7Z" />
                  </svg>
                  {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
                </button>
                {googleError && <p className="text-sm text-red-600 text-center">{googleError}</p>}
                {signUpError && <p className="text-sm text-red-600 text-center">{signUpError}</p>}
                <p className="text-center text-sm text-slate-500">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('signin')
                      setSignUpError('')
                      setOtpError('')
                      setGoogleError('')
                    }}
                    className="text-indigo-600 font-medium hover:text-indigo-700 cursor-pointer"
                  >
                    Sign In
                  </button>
                </p>
              </form>
            )}
          </div>
        ) : (
          /* Verify Step */
          <div className="p-8">
            <button
              type="button"
              onClick={() => { setStep('form'); setOtpError('') }}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>

            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-100 mb-4">
                <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Check your email</h2>
              <p className="text-sm text-slate-500">
                We sent a 6-digit code to{' '}
                <span className="font-medium text-slate-700">{verifyEmail}</span>
              </p>
            </div>

            <form onSubmit={handleVerify}>
              <div className="flex justify-center gap-2.5 mb-2" onPaste={handleOtpPaste}>
                {otpValues.map((val, i) => (
                  <input
                    key={i}
                    ref={(el) => (otpRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={val}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className={`w-12 h-14 text-center text-xl font-bold rounded-xl border-2 transition-all focus:outline-none ${
                      otpError
                        ? 'border-red-300 text-red-600 focus:ring-2 focus:ring-red-200 focus:border-red-400'
                        : 'border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500'
                    }`}
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>

              {otpError && (
                <p className="text-center text-sm text-red-500 mb-4 font-medium">{otpError}</p>
              )}
              {otpInfo && !otpError && (
                <p className="text-center text-xs text-slate-500 mb-4 font-medium">{otpInfo}</p>
              )}

              <div className="mt-6">
                <button
                  type="submit"
                  disabled={authLoading}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-200 ${
                    authLoading
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer'
                  }`}
                >
                  {authLoading ? 'Verifying...' : 'Verify Code'}
                </button>
              </div>

              <div className="text-center mt-4">
                {canResend ? (
                  <button
                    type="button"
                    onClick={handleResend}
                    className="text-sm text-indigo-600 font-medium hover:text-indigo-700 cursor-pointer transition-colors"
                  >
                    Resend Code
                  </button>
                ) : (
                  <p className="text-sm text-slate-400">
                    Resend code in <span className="font-semibold text-slate-500">{countdown}s</span>
                  </p>
                )}
              </div>
            </form>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
