const express = require('express')
const router = express.Router()
const multer = require('multer')
const OpenAI = require('openai')
const { toFile } = require('openai')
const authMiddleware = require('../middleware/authMiddleware')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

function detectDominantLanguage(text) {
  if (!text) return 'English'
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length
  const totalChars = text.replace(/\s/g, '').length
  if (totalChars === 0) return 'English'
  return arabicChars / totalChars > 0.4 ? 'Arabic' : 'English'
}

router.post('/transcribe', authMiddleware, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  try {
    const openai = new OpenAI({ apiKey })
    const audioFile = await toFile(req.file.buffer, req.file.originalname || 'recording.webm', {
      type: req.file.mimetype || 'audio/webm',
    })

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
    })

    // Use Whisper's own language detection — far more reliable than character counting
    const rawLang = (transcription.language || '').trim().toLowerCase()
    const detectedLanguage = rawLang
      ? rawLang.charAt(0).toUpperCase() + rawLang.slice(1)
      : detectDominantLanguage(transcription.text)
    return res.json({ text: transcription.text, detectedLanguage })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Transcription failed' })
  }
})

router.post('/generate-email', authMiddleware, async (req, res) => {
  const { recipient, subject, userPrompt, detectedLanguage: clientLanguage } = req.body
  const detectedLanguage = clientLanguage || detectDominantLanguage(userPrompt)

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
              `You are a professional email writer. Write ONLY the email content, nothing else. Write the email in ${detectedLanguage}. Do not switch languages. Do not add any explanation. Write a complete, well-structured, professional email with proper greeting, body, and closing. Do NOT restate or summarize the instructions — write the actual email. Return only the email body text, no subject line, no markdown.`,
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
