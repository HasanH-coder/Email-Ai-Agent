const express = require('express')

const supabase = require('../config/supabase')

const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*').limit(1)

    return res.status(200).json({
      ok: !error,
      data: data || null,
      error: error || null,
    })
  } catch (error) {
    return res.status(200).json({
      ok: false,
      data: null,
      error: {
        message: error.message || 'Unexpected error during Supabase query.',
      },
    })
  }
})

module.exports = router

