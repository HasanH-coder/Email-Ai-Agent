const express = require('express')
const router = express.Router()
const multer = require('multer')
const OpenAI = require('openai')
const { toFile } = require('openai')
const authMiddleware = require('../middleware/authMiddleware')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

const SUPPORTED_LANGUAGE_VARIANTS = [
  { name: 'English', variants: ['english', 'anglais', 'ingles', 'englisch', 'ingilizce', 'الانجليزية', 'الإنجليزية'] },
  { name: 'Arabic', variants: ['arabic', 'arabe', 'arabisch', 'arapca', 'arapça', 'العربية', 'عربي'] },
  { name: 'Spanish', variants: ['spanish', 'espanol', 'espagnol', 'spanisch', 'ispanyolca', 'الاسبانية', 'الإسبانية', 'اسباني', 'إسباني'] },
  { name: 'French', variants: ['french', 'francais', 'frances', 'franzosisch', 'französisch', 'fransizca', 'fransızca', 'الفرنسية', 'فرنسي', 'فرنسية'] },
  { name: 'German', variants: ['german', 'allemand', 'aleman', 'deutsch', 'almanca', 'الالمانية', 'الألمانية', 'الماني', 'ألماني'] },
  { name: 'Turkish', variants: ['turkish', 'turc', 'turco', 'turkce', 'türkçe', 'تركية', 'التركية', 'تركي'] },
]

function normalizeLanguageText(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064b-\u065f\u0670]/g, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function detectDominantLanguage(text) {
  if (!text) return 'English'

  const normalizedText = normalizeLanguageText(text)
  const arabicChars = (normalizedText.match(/[\u0600-\u06FF]/g) || []).length
  const totalChars = normalizedText.replace(/\s/g, '').length

  if (totalChars === 0) return 'English'
  if (arabicChars / totalChars > 0.4) return 'Arabic'

  const counts = SUPPORTED_LANGUAGE_VARIANTS.map((language) => ({
    name: language.name,
    matches: language.variants.reduce((count, variant) => {
      const regex = new RegExp(`(^|[^\\p{L}])${escapeRegExp(normalizeLanguageText(variant))}([^\\p{L}]|$)`, 'gu')
      return count + (normalizedText.match(regex)?.length || 0)
    }, 0),
  }))

  const bestMatch = counts.sort((left, right) => right.matches - left.matches)[0]
  if (bestMatch?.matches > 0) return bestMatch.name

  return 'English'
}

function detectRequestedOutputLanguage(text) {
  if (!text) return null

  const normalizedText = normalizeLanguageText(text)

  for (const language of SUPPORTED_LANGUAGE_VARIANTS) {
    for (const variant of language.variants.map((item) => normalizeLanguageText(item))) {
      const escapedVariant = escapeRegExp(variant)
      const connectorPattern = new RegExp(`\\b(?:in|into|en|auf)\\s+${escapedVariant}\\b`, 'u')
      const makeItPattern = new RegExp(`\\b(?:make|write|generate|reply|compose|draft|create)\\b[\\s\\S]{0,20}?${escapedVariant}\\b`, 'u')
      const arabicConnectorPattern = new RegExp(`(?:باللغة\\s*|بال)${escapedVariant}(?=$|[\\s,.!?،؛])`, 'u')

      if (
        connectorPattern.test(normalizedText) ||
        makeItPattern.test(normalizedText) ||
        arabicConnectorPattern.test(normalizedText)
      ) {
        return language.name
      }
    }
  }

  return null
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
  const {
    recipient,
    subject,
    userPrompt,
    detectedLanguage: legacyDetectedLanguage,
    detectedInputLanguage: clientInputLanguage,
  } = req.body

  const detectedInputLanguage = clientInputLanguage || legacyDetectedLanguage || detectDominantLanguage(userPrompt)
  const detectedOutputLanguage = detectRequestedOutputLanguage(userPrompt)
  const finalLanguage = detectedOutputLanguage || detectedInputLanguage

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
    const userMessage = [
      `Write a professional email${context}.`,
      `Transcribed or typed instruction: ${userPrompt}`,
      `Detected input language: ${detectedInputLanguage}`,
      `Detected target output language: ${detectedOutputLanguage || 'Not explicitly requested'}`,
    ].join('\n')

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
              `You are a professional email writer. The user may speak in one language and request the final email in another language. Always write the final email in the explicitly requested target language if one is provided. If no target language is explicitly requested, write in the dominant language of the user's instruction. Write ONLY the email content, nothing else. Write the email in ${finalLanguage}. Do not switch languages. Do not add any explanation. Write a complete, well-structured, professional email with proper greeting, body, and closing. Do NOT restate or summarize the instructions. Return only the email body text, no subject line, no markdown.`,
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
