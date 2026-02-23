const supabase = require('../config/supabase')

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' })
  }

  try {
    const { data, error } = await supabase.auth.getUser(token)

    if (error || !data?.user) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' })
    }

    req.user = {
      userId: data.user.id,
      email: data.user.email,
    }

    return next()
  } catch (error) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' })
  }
}

module.exports = authMiddleware
