const express = require('express')

const authMiddleware = require('../middleware/authMiddleware')

const router = express.Router()

router.use(authMiddleware)

router.post('/google/start', (req, res) => {
  const origin = req.get('origin') || 'http://localhost:5173'
  return res.status(200).json({
    ok: true,
    url: `${origin}/auth/callback?provider=google`,
  })
})

router.post('/microsoft/start', (req, res) => {
  const origin = req.get('origin') || 'http://localhost:5173'
  return res.status(200).json({
    ok: true,
    url: `${origin}/auth/callback?provider=azure`,
  })
})

module.exports = router
