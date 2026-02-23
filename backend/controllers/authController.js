const supabase = require('../config/supabase')
const jwt = require('jsonwebtoken')

function createToken(user) {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET in environment variables.')
  }

  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
    },
    jwtSecret,
    { expiresIn: '7d' }
  )
}

async function signup(req, res) {
  const { email } = req.body || {}

  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, error: 'Email is required' })
  }

  const normalizedEmail = String(email).trim()

  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{ email: normalizedEmail }])
      .select()
      .single()

    if (error) {
      return res.status(400).json({ ok: false, error })
    }

    const token = createToken(data)
    return res.status(200).json({ ok: true, user: data, token })
  } catch (error) {
    return res.status(400).json({ ok: false, error: { message: error.message } })
  }
}

async function login(req, res) {
  const { email } = req.body || {}

  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, error: 'Email is required' })
  }

  const normalizedEmail = String(email).trim()

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .single()

    if (error) {
      // Supabase returns no rows as an error for .single()
      if (error.code === 'PGRST116') {
        return res.status(404).json({ ok: false, message: 'User not found' })
      }
      return res.status(400).json({ ok: false, error })
    }

    const token = createToken(data)
    return res.status(200).json({ ok: true, user: data, token })
  } catch (error) {
    return res.status(400).json({ ok: false, error: { message: error.message } })
  }
}

function me(req, res) {
  return res.status(200).json({ ok: true, user: req.user })
}

module.exports = {
  signup,
  login,
  me,
}
