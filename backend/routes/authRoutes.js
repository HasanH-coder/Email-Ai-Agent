const express = require('express')

const { signup, login, me } = require('../controllers/authController')
const authMiddleware = require('../middleware/authMiddleware')
const { upsertConnectedAccountTokens } = require('../utils/connectedAccounts')

const router = express.Router()

router.post('/signup', signup)
router.post('/login', login)
router.get('/me', authMiddleware, me)

// --- Microsoft OAuth for connecting Outlook as secondary provider ---
// The user is already logged in (has a Supabase session). We use a custom
// backend OAuth flow so we never create a new Supabase user or switch sessions.

// Redirect URI registered in Azure — must point to this backend callback route.
const MICROSOFT_BACKEND_REDIRECT = `${process.env.PUBLIC_BACKEND_URL || 'http://localhost:5001'}/api/auth/microsoft/callback`

router.get('/microsoft/authorize', authMiddleware, (req, res) => {
  const userId = req.user.userId
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  // Optional email hint — if the caller knows the user's Microsoft email upfront,
  // pass it as ?email=user@domain.com to enable domain_hint for federated accounts.
  const loginHint = typeof req.query.email === 'string' ? req.query.email.trim() : ''
  const domainHint = loginHint.includes('@') ? loginHint.split('@')[1] : ''

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: MICROSOFT_BACKEND_REDIRECT,
    scope: [
      'openid', 'profile', 'email', 'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
    ].join(' '),
    prompt: 'login',
    state: Buffer.from(JSON.stringify({ userId, frontendUrl })).toString('base64'),
  })

  if (loginHint) params.set('login_hint', loginHint)
  if (domainHint) params.set('domain_hint', domainHint)

  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  console.log('[Microsoft OAuth] Authorization URL:', url)
  return res.json({ url })
})

// Microsoft redirects here after the user logs in (mirrors the Google callback flow).
router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (oauthError || !code || !state) {
    console.error('Microsoft OAuth callback error:', oauthError)
    return res.redirect(`${frontendUrl}/dashboard?connect_error=outlook`)
  }

  let userId
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'))
    userId = decoded.userId
  } catch {
    return res.redirect(`${frontendUrl}/dashboard?connect_error=outlook`)
  }

  if (!userId) {
    return res.redirect(`${frontendUrl}/dashboard?connect_error=outlook`)
  }

  try {
    const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: MICROSOFT_BACKEND_REDIRECT,
      }).toString(),
    })

    if (!tokenResp.ok) {
      const errText = await tokenResp.text()
      console.error('Microsoft token exchange failed:', errText)
      return res.redirect(`${frontendUrl}/dashboard?connect_error=outlook`)
    }

    const tokens = await tokenResp.json()

    const profileResp = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = profileResp.ok ? await profileResp.json() : {}
    const email = profile.mail || profile.userPrincipalName || ''

    try {
      await upsertConnectedAccountTokens({
        codePath: 'auth.microsoft.callback',
        userId,
        provider: 'outlook',
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : undefined,
      })
    } catch (upsertError) {
      console.error('Failed to upsert Outlook account:', upsertError)
      return res.redirect(`${frontendUrl}/dashboard?connect_error=outlook`)
    }

    return res.redirect(`${frontendUrl}/dashboard?connected=outlook`)
  } catch (err) {
    console.error('Microsoft callback error:', err)
    return res.redirect(`${frontendUrl}/dashboard?connect_error=outlook`)
  }
})

// --- Google OAuth for connecting Gmail as secondary provider ---

router.get('/google/authorize', authMiddleware, (req, res) => {
  const userId = req.user.userId
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const redirectUri = `${process.env.PUBLIC_BACKEND_URL || 'http://localhost:5001'}/api/auth/google/callback`

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: Buffer.from(JSON.stringify({ userId, frontendUrl })).toString('base64'),
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return res.json({ url })
})

router.get('/google/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (oauthError || !code || !state) {
    console.error('Google OAuth callback error:', oauthError)
    return res.redirect(`${frontendUrl}/dashboard?connect_error=gmail`)
  }

  let userId
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'))
    userId = decoded.userId
  } catch {
    return res.redirect(`${frontendUrl}/dashboard?connect_error=gmail`)
  }

  if (!userId) {
    return res.redirect(`${frontendUrl}/dashboard?connect_error=gmail`)
  }

  try {
    const redirectUri = `${process.env.PUBLIC_BACKEND_URL || 'http://localhost:5001'}/api/auth/google/callback`

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })

    if (!tokenResp.ok) {
      const errText = await tokenResp.text()
      console.error('Google token exchange failed:', errText)
      return res.redirect(`${frontendUrl}/dashboard?connect_error=gmail`)
    }

    const tokens = await tokenResp.json()

    // Get email from Google
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = profileResp.ok ? await profileResp.json() : {}
    const email = profile.email || ''

    try {
      await upsertConnectedAccountTokens({
        codePath: 'auth.google.callback',
        userId,
        provider: 'gmail',
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : undefined,
      })
    } catch (upsertError) {
      console.error('Failed to upsert Gmail account:', upsertError)
      return res.redirect(`${frontendUrl}/dashboard?connect_error=gmail`)
    }

    return res.redirect(`${frontendUrl}/dashboard?connected=gmail`)
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    return res.redirect(`${frontendUrl}/dashboard?connect_error=gmail`)
  }
})

module.exports = router
