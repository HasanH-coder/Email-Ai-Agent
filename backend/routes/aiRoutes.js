const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/authMiddleware')

router.post('/generate-email', authMiddleware, async (req, res) => {
  const { recipient, subject, userPrompt } = req.body

  if (!userPrompt || !userPrompt.trim()) {
    return res.status(400).json({ error: 'userPrompt is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  try {
    const contextParts = []
    if (recipient) contextParts.push(`to ${recipient}`)
    if (subject) contextParts.push(`with subject "${subject}"`)
    const context = contextParts.length ? ` ${contextParts.join(' ')}` : ''
    const userMessage = `Write a professional email${context}. The user's instructions are: ${userPrompt}`

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        max_completion_tokens: 1000,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional email writer. Write clear, concise, and professional emails. Return only the email body text — no subject line, no markdown formatting, just the plain email body.',
          },
          { role: 'user', content: userMessage },
        ],
      }),
    })

    const data = await openaiResponse.json()

    if (!openaiResponse.ok) {
      return res.status(502).json({ error: data.error?.message || 'OpenAI API error' })
    }

    const emailText = data.choices?.[0]?.message?.content?.trim() || ''
    return res.json({ emailText })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' })
  }
})

module.exports = router
