const supabase = require('../config/supabase')

async function getAccounts(req, res) {
  const userId = req.user.userId

  const { data, error } = await supabase.from('accounts').select('*').eq('user_id', userId)

  if (error) {
    return res.status(400).json({ ok: false, error })
  }

  return res.status(200).json({ ok: true, accounts: data })
}

async function createAccount(req, res) {
  const userId = req.user.userId
  const { provider, email } = req.body || {}

  if (!provider || !String(provider).trim() || !email || !String(email).trim()) {
    return res.status(400).json({ ok: false, error: 'provider and email are required' })
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert([
      {
        user_id: userId,
        provider: String(provider).trim(),
        email: String(email).trim(),
        connected: false,
      },
    ])
    .select()
    .single()

  if (error) {
    return res.status(400).json({ ok: false, error })
  }

  return res.status(201).json({ ok: true, account: data })
}

module.exports = {
  getAccounts,
  createAccount,
}
