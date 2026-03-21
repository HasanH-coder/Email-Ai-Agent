const express = require('express')

const { signup, login, me } = require('../controllers/authController')
const authMiddleware = require('../middleware/authMiddleware')
const supabaseAdmin = require('../config/supabase')

const router = express.Router()

router.post('/signup', signup)
router.post('/login', login)
router.get('/me', authMiddleware, me)

// --- Microsoft OAuth for connecting Outlook as secondary provider ---
// The user is already logged in (has a Supabase session). We use a custom
// backend OAuth flow so we never create a new Supabase user or switch sessions.

// Redirect URI must already be registered in Azure — use the frontend dashboard URL
const MICROSOFT_FRONTEND_REDIRECT = 'http://localhost:5173/dashboard'

router.get('/microsoft/authorize', authMiddleware, (req, res) => {
  const userId = req.user.userId

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MICROSOFT_FRONTEND_REDIRECT,
    scope: [
      'openid', 'profile', 'email', 'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
    ].join(' '),
    prompt: 'consent',
    state: Buffer.from(JSON.stringify({ userId, provider: 'outlook' })).toString('base64'),
  })

  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  return res.json({ url })
})

// Frontend sends the code here after Microsoft redirects back to /dashboard?code=...
router.post('/microsoft/exchange', authMiddleware, async (req, res) => {
  const { code } = req.body || {}
  const userId = req.user.userId

  if (!code) return res.status(400).json({ ok: false, message: 'Missing code.' })

  try {
    const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: MICROSOFT_FRONTEND_REDIRECT,
      }).toString(),
    })

    if (!tokenResp.ok) {
      const errText = await tokenResp.text()
      console.error('Microsoft token exchange failed:', errText)
      return res.status(400).json({ ok: false, message: 'Token exchange failed.' })
    }

    const tokens = await tokenResp.json()

    const profileResp = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = profileResp.ok ? await profileResp.json() : {}
    const email = profile.mail || profile.userPrincipalName || ''

    const { error: upsertError } = await supabaseAdmin.from('connected_accounts').upsert(
      [{
        user_id: userId,
        provider: 'outlook',
        email,
        provider_access_token: tokens.access_token,
        provider_refresh_token: tokens.refresh_token || null,
      }],
      { onConflict: 'user_id,provider' }
    )

    if (upsertError) {
      console.error('Failed to upsert Outlook account:', upsertError)
      return res.status(500).json({ ok: false, message: 'Failed to save account.' })
    }

    return res.json({ ok: true, email })
  } catch (err) {
    console.error('Microsoft exchange error:', err)
    return res.status(500).json({ ok: false, message: 'Internal error.' })
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

    const { error: upsertError } = await supabaseAdmin.from('connected_accounts').upsert(
      [{
        user_id: userId,
        provider: 'gmail',
        email,
        provider_access_token: tokens.access_token,
        provider_refresh_token: tokens.refresh_token || null,
      }],
      { onConflict: 'user_id,provider' }
    )

    if (upsertError) {
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
