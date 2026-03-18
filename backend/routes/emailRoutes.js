const express = require('express')

const router = express.Router()

function getHeaderValue(headers = [], name) {
  const normalizedName = name.toLowerCase()
  const header = headers.find((item) => item.name?.toLowerCase() === normalizedName)
  return header?.value || ''
}

function parseFromHeader(from = '') {
  const trimmedFrom = from.trim()
  const match = trimmedFrom.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>$/)

  if (match) {
    return {
      from: trimmedFrom,
      fromName: match[1]?.trim() || match[2].trim(),
      fromEmail: match[2].trim(),
    }
  }

  return {
    from: trimmedFrom,
    fromName: trimmedFrom || 'Unknown Sender',
    fromEmail: '',
  }
}

function decodeBase64Url(value = '') {
  if (!value) return ''

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function stripHtml(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractBodiesFromPayload(payload) {
  const result = {
    bodyText: '',
    bodyHtml: '',
  }

  if (!payload) {
    return result
  }

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    result.bodyText = decodeBase64Url(payload.body.data)
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    result.bodyHtml = decodeBase64Url(payload.body.data)
  }

  const parts = Array.isArray(payload.parts) ? payload.parts : []
  for (const part of parts) {
    const childBodies = extractBodiesFromPayload(part)
    if (!result.bodyText && childBodies.bodyText) {
      result.bodyText = childBodies.bodyText
    }
    if (!result.bodyHtml && childBodies.bodyHtml) {
      result.bodyHtml = childBodies.bodyHtml
    }
  }

  if (!result.bodyText && payload.body?.data) {
    result.bodyText = decodeBase64Url(payload.body.data)
  }

  return result
}

function normalizeGmailMessage(messageData) {
  const headers = messageData.payload?.headers || []
  const subject = getHeaderValue(headers, 'Subject') || '(No Subject)'
  const from = getHeaderValue(headers, 'From')
  const date = getHeaderValue(headers, 'Date')
  const { fromName, fromEmail } = parseFromHeader(from)

  return {
    id: messageData.id,
    subject,
    from,
    fromName,
    fromEmail,
    snippet: messageData.snippet || '',
    date,
    internalDate: messageData.internalDate || null,
    labelIds: Array.isArray(messageData.labelIds) ? messageData.labelIds : [],
  }
}

async function fetchGmailJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    const error = new Error(`Gmail API request failed with status ${response.status}.`)
    error.statusCode = response.status
    error.gmailError = errorText
    throw error
  }

  return response.json()
}

async function fetchGmailResponse(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    const error = new Error(`Gmail API request failed with status ${response.status}.`)
    error.statusCode = response.status
    error.gmailError = errorText
    throw error
  }

  return response
}

async function fetchGmailMessagesByIds(messageIds, token) {
  return Promise.all(
    messageIds.map(async (id) => {
      const messageData = await fetchGmailJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
        token
      )

      return normalizeGmailMessage(messageData)
    })
  )
}

function encodeBase64Url(value = '') {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function fetchGmailProfileEmail(token) {
  const profile = await fetchGmailJson(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    token
  )

  return profile.emailAddress
}

function buildRawEmail({ from, to, subject, body }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject || '(No Subject)'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n')
}

router.get('/gmail', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const maxResults = Math.min(Number(req.query.maxResults) || 25, 100)
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : ''
    const params = new URLSearchParams({ maxResults: String(maxResults), labelIds: 'INBOX' })

    if (pageToken) {
      params.set('pageToken', pageToken)
    }

    const listData = await fetchGmailJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
      token
    )
    const messages = Array.isArray(listData.messages) ? listData.messages : []
    const emailItems = await fetchGmailMessagesByIds(messages.map(({ id }) => id), token)

    return res.status(200).json({
      emails: emailItems,
      nextPageToken: listData.nextPageToken || null,
    })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to fetch Gmail messages.',
        gmail_error: error.gmailError,
      })
    }

    return next(error)
  }
})

router.get('/gmail/inbox-meta', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    await fetchGmailJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', token)
    const unreadData = await fetchGmailJson(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is:unread&maxResults=1',
      token
    )

    return res.status(200).json({
      unreadInboxCount: Number(unreadData.resultSizeEstimate) || 0,
    })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to fetch Gmail inbox metadata.',
        gmail_error: error.gmailError,
      })
    }

    return next(error)
  }
})

router.get('/gmail/sent', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const listData = await fetchGmailJson(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=25',
      token
    )
    const messages = Array.isArray(listData.messages) ? listData.messages : []
    const emailItems = await fetchGmailMessagesByIds(messages.map(({ id }) => id), token)

    return res.status(200).json({ emails: emailItems })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to fetch Gmail sent emails.',
        gmail_error: error.gmailError,
      })
    }

    return next(error)
  }
})

router.get('/gmail/drafts', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const listData = await fetchGmailJson(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=25',
      token
    )
    const drafts = Array.isArray(listData.drafts) ? listData.drafts : []

    const normalizedDrafts = await Promise.all(
      drafts.map(async ({ id }) => {
        const draftData = await fetchGmailJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${id}`,
          token
        )
        const headers = draftData.message?.payload?.headers || []

        return {
          id: draftData.id,
          to: getHeaderValue(headers, 'To'),
          subject: getHeaderValue(headers, 'Subject') || '(No Subject)',
          snippet: draftData.message?.snippet || '',
          date: getHeaderValue(headers, 'Date'),
          internalDate: draftData.message?.internalDate || null,
        }
      })
    )

    return res.status(200).json({ drafts: normalizedDrafts })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to fetch Gmail drafts.',
        gmail_error: error.gmailError,
      })
    }

    return next(error)
  }
})

router.post('/gmail/send', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()
  console.log('[gmail-send] request body:', { to, subject, bodyLength: body.length })

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  if (!to || !body) {
    return res.status(400).json({ message: 'Missing required fields: to, body.' })
  }

  try {
    const userEmail = await fetchGmailProfileEmail(token)
    console.log('[gmail-send] profile fetch succeeded:', Boolean(userEmail))
    console.log('[gmail-send] using From:', userEmail)

    const rawEmail = buildRawEmail({ from: userEmail, to, subject, body })

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: encodeBase64Url(rawEmail),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GMAIL SEND ERROR:', errorText)
      return res.status(response.status).json({
        message: 'Failed to send Gmail email.',
        gmail_error: errorText,
      })
    }

    const responseData = await response.json()
    return res.status(200).json({
      success: true,
      id: responseData.id,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/gmail/drafts', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const userEmail = await fetchGmailProfileEmail(token)
    const raw = encodeBase64Url(buildRawEmail({ from: userEmail, to, subject, body }))
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GMAIL DRAFT CREATE ERROR:', errorText)
      return res.status(response.status).json({
        message: 'Failed to create Gmail draft.',
        gmail_error: errorText,
      })
    }

    const responseData = await response.json()
    return res.status(200).json({
      success: true,
      id: responseData.id,
      message: responseData.message,
    })
  } catch (error) {
    return next(error)
  }
})

router.put('/gmail/drafts/:id', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const userEmail = await fetchGmailProfileEmail(token)
    const raw = encodeBase64Url(buildRawEmail({ from: userEmail, to, subject, body }))
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${req.params.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: req.params.id,
        message: { raw },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GMAIL DRAFT UPDATE ERROR:', errorText)
      return res.status(response.status).json({
        message: 'Failed to update Gmail draft.',
        gmail_error: errorText,
      })
    }

    const responseData = await response.json()
    return res.status(200).json({
      success: true,
      id: responseData.id,
      message: responseData.message,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/gmail/drafts/:id/send', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: req.params.id,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GMAIL DRAFT SEND ERROR:', errorText)
      return res.status(response.status).json({
        message: 'Failed to send Gmail draft.',
        gmail_error: errorText,
      })
    }

    const responseData = await response.json()
    return res.status(200).json({
      success: true,
      id: responseData.id,
      threadId: responseData.threadId,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete('/gmail/drafts/:id', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${req.params.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GMAIL DRAFT DELETE ERROR:', errorText)
      return res.status(response.status).json({
        message: 'Failed to delete Gmail draft.',
        gmail_error: errorText,
      })
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    return next(error)
  }
})

router.get('/gmail/:id', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const messageData = await fetchGmailJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}`,
      token
    )
    const normalizedMessage = normalizeGmailMessage(messageData)
    const { bodyText, bodyHtml } = extractBodiesFromPayload(messageData.payload)

    return res.status(200).json({
      ...normalizedMessage,
      bodyText: bodyText || (bodyHtml ? stripHtml(bodyHtml) : normalizedMessage.snippet),
      bodyHtml: bodyHtml || '',
    })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to fetch Gmail message.',
        gmail_error: error.gmailError,
      })
    }

    return next(error)
  }
})

router.patch('/gmail/:id/read', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const read = Boolean(req.body?.read)

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    await fetchGmailResponse(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/modify`,
      token,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          read
            ? { removeLabelIds: ['UNREAD'] }
            : { addLabelIds: ['UNREAD'] }
        ),
      }
    )

    return res.status(200).json({ ok: true, read })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to update Gmail read state.',
        gmail_error: error.gmailError,
        reconnectRequired: error.statusCode === 401 || error.statusCode === 403,
      })
    }

    return next(error)
  }
})

module.exports = router
