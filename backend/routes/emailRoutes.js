const express = require('express')
const supabaseAdmin = require('../config/supabase')
const {
  getPreferredConnectedAccount,
  updateConnectedAccountTokens,
} = require('../utils/connectedAccounts')

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
    attachments: [],
  }

  if (!payload) {
    return result
  }

  const filename = payload.filename || ''
  const disposition = (payload.headers || []).find((h) => h.name?.toLowerCase() === 'content-disposition')?.value || ''
  const isAttachment = Boolean(filename) || disposition.toLowerCase().startsWith('attachment')

  if (isAttachment && payload.body?.attachmentId) {
    result.attachments.push({
      attachmentId: payload.body.attachmentId,
      filename: filename || 'attachment',
      mimeType: payload.mimeType || 'application/octet-stream',
      size: payload.body.size || 0,
    })
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
    result.attachments.push(...childBodies.attachments)
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

  const parts = messageData.payload?.parts || []
  const hasAttachments = parts.some((p) => p.filename && p.filename.length > 0)

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
    hasAttachments,
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

function buildRawEmail({ from, to, subject, body, attachments = [] }) {
  if (attachments.length === 0) {
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

  const boundary = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject || '(No Subject)'}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ]

  for (const att of attachments) {
    const safeFilename = (att.name || 'attachment').replace(/"/g, '')
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${safeFilename}"`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push(`Content-Disposition: attachment; filename="${safeFilename}"`)
    lines.push('')
    // Split base64 into 76-character lines per RFC 2045
    const b64 = att.data || ''
    for (let i = 0; i < b64.length; i += 76) {
      lines.push(b64.slice(i, i + 76))
    }
  }

  lines.push(`--${boundary}--`)
  return lines.join('\r\n')
}

router.get('/gmail', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  try {
    const maxResults = Math.min(Number(req.query.maxResults) || 25, 100)
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : ''
    const params = new URLSearchParams({ maxResults: String(maxResults), labelIds: 'INBOX' })
    if (pageToken) params.set('pageToken', pageToken)

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`
    let listData
    try {
      listData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { accessToken = freshToken; listData = await fetchGmailJson(url, freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    const messages = Array.isArray(listData.messages) ? listData.messages : []
    const emailItems = await fetchGmailMessagesByIds(messages.map(({ id }) => id), accessToken)

    return res.status(200).json({
      emails: emailItems,
      nextPageToken: listData.nextPageToken || null,
    })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Gmail messages.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.get('/gmail/inbox-meta', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  try {
    const unreadUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is:unread&maxResults=1'
    let unreadData
    try {
      await fetchGmailJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', accessToken)
      unreadData = await fetchGmailJson(unreadUrl, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) {
          accessToken = freshToken
          await fetchGmailJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', accessToken)
          unreadData = await fetchGmailJson(unreadUrl, accessToken)
        } else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ unreadInboxCount: Number(unreadData.resultSizeEstimate) || 0 })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Gmail inbox metadata.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.get('/gmail/sent', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=50'
    let listData
    try {
      listData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { accessToken = freshToken; listData = await fetchGmailJson(url, freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    const messages = Array.isArray(listData.messages) ? listData.messages : []
    const emailItems = await fetchGmailMessagesByIds(messages.map(({ id }) => id), accessToken)
    return res.status(200).json({ emails: emailItems })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Gmail sent emails.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.get('/gmail/drafts', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=25'
    let listData
    try {
      listData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { accessToken = freshToken; listData = await fetchGmailJson(url, freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    const drafts = Array.isArray(listData.drafts) ? listData.drafts : []

    const normalizedDrafts = await Promise.all(
      drafts.map(async ({ id }) => {
        const draftData = await fetchGmailJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${id}`,
          accessToken
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
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Gmail drafts.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.post('/gmail/send', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : []

  if (!to || !body) return res.status(400).json({ message: 'Missing required fields: to, body.' })

  const GMAIL_MAX_BYTES = 25 * 1024 * 1024
  for (const att of attachments) {
    const sizeBytes = Math.ceil((att.data?.length || 0) * 3 / 4)
    if (sizeBytes > GMAIL_MAX_BYTES) {
      return res.status(400).json({ message: `Attachment "${att.name}" exceeds the 25 MB Gmail limit.` })
    }
  }

  async function doSend(tok) {
    const userEmail = await fetchGmailProfileEmail(tok)
    const rawEmail = buildRawEmail({ from: userEmail, to, subject, body, attachments })
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encodeBase64Url(rawEmail) }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error('Failed to send Gmail email.')
      err.statusCode = response.status; err.gmailError = errorText; throw err
    }
    return response.json()
  }

  try {
    let responseData
    try {
      responseData = await doSend(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { responseData = await doSend(freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL SEND ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to send Gmail email.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.post('/gmail/drafts', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  async function doCreate(tok) {
    const userEmail = await fetchGmailProfileEmail(tok)
    const raw = encodeBase64Url(buildRawEmail({ from: userEmail, to, subject, body }))
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw } }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error('Failed to create Gmail draft.')
      err.statusCode = response.status; err.gmailError = errorText; throw err
    }
    return response.json()
  }

  try {
    let responseData
    try {
      responseData = await doCreate(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { responseData = await doCreate(freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id, message: responseData.message })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT CREATE ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to create Gmail draft.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.put('/gmail/drafts/:id', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()
  const draftId = req.params.id

  async function doUpdate(tok) {
    const userEmail = await fetchGmailProfileEmail(tok)
    const raw = encodeBase64Url(buildRawEmail({ from: userEmail, to, subject, body }))
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draftId, message: { raw } }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error('Failed to update Gmail draft.')
      err.statusCode = response.status; err.gmailError = errorText; throw err
    }
    return response.json()
  }

  try {
    let responseData
    try {
      responseData = await doUpdate(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { responseData = await doUpdate(freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id, message: responseData.message })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT UPDATE ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to update Gmail draft.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.post('/gmail/drafts/:id/send', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  async function doSendDraft(tok) {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: req.params.id }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error('Failed to send Gmail draft.')
      err.statusCode = response.status; err.gmailError = errorText; throw err
    }
    return response.json()
  }

  try {
    let responseData
    try {
      responseData = await doSendDraft(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { responseData = await doSendDraft(freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id, threadId: responseData.threadId })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT SEND ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to send Gmail draft.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.delete('/gmail/drafts/:id', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  async function doDelete(tok) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${req.params.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error('Failed to delete Gmail draft.')
      err.statusCode = response.status; err.gmailError = errorText; throw err
    }
  }

  try {
    try {
      await doDelete(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { await doDelete(freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT DELETE ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to delete Gmail draft.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.get('/gmail/:id', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}`
    let messageData
    try {
      messageData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { accessToken = freshToken; messageData = await fetchGmailJson(url, freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    const normalizedMessage = normalizeGmailMessage(messageData)
    const { bodyText, bodyHtml, attachments } = extractBodiesFromPayload(messageData.payload)

    return res.status(200).json({
      ...normalizedMessage,
      bodyText: bodyText || (bodyHtml ? stripHtml(bodyHtml) : normalizedMessage.snippet),
      bodyHtml: bodyHtml || '',
      attachments,
    })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Gmail message.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

router.patch('/gmail/:id/read', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  const read = Boolean(req.body?.read)
  const modifyBody = JSON.stringify(read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] })
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/modify`
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: modifyBody }

  try {
    try {
      await fetchGmailResponse(url, accessToken, opts)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { await fetchGmailResponse(url, freshToken, opts) }
        else throw gmailError
      } else throw gmailError
    }
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

router.patch('/gmail/:id/star', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  const starred = Boolean(req.body?.starred)
  const modifyBody = JSON.stringify(starred ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] })
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/modify`
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: modifyBody }

  try {
    try {
      await fetchGmailResponse(url, accessToken, opts)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { await fetchGmailResponse(url, freshToken, opts) }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ ok: true, starred })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return res.status(error.statusCode || 500).json({
        message: 'Failed to update Gmail star state.',
        gmail_error: error.gmailError,
        reconnectRequired: error.statusCode === 401 || error.statusCode === 403,
      })
    }
    return next(error)
  }
})

router.get('/gmail/:id/attachments/:attachmentId', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })
  const tokens = await getGmailTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Gmail account not connected or token missing.' })
  let { accessToken, refreshToken } = tokens

  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/attachments/${req.params.attachmentId}`
    let data
    try {
      data = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshGoogleToken(userId, refreshToken)
        if (freshToken) { data = await fetchGmailJson(url, freshToken) }
        else throw gmailError
      } else throw gmailError
    }
    const buffer = Buffer.from((data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', buffer.length)
    return res.send(buffer)
  } catch (error) {
    if (error.gmailError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Gmail attachment.', gmail_error: error.gmailError })
    }
    return next(error)
  }
})

// --- Shared auth helper ---

async function getUserIdFromSupabaseToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !data?.user?.id) return null
    return data.user.id
  } catch {
    return null
  }
}

// --- Gmail DB-based token helpers ---

async function getGmailTokens(userId) {
  try {
    const data = await getPreferredConnectedAccount({
      userId,
      provider: 'gmail',
      requireAccessToken: true,
    })
    if (!data?.provider_access_token) return null
    return {
      email: data.email || '',
      accessToken: data.provider_access_token,
      refreshToken: data.provider_refresh_token || null,
    }
  } catch (error) {
    console.error('Failed to load Gmail tokens:', error)
    return null
  }
}

async function tryRefreshGoogleToken(userId, refreshToken) {
  if (!refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null
  try {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (!data.access_token) return null
    await updateConnectedAccountTokens({
      codePath: 'emails.gmail.refresh',
      userId,
      provider: 'gmail',
      accessToken: data.access_token,
      refreshToken: Object.prototype.hasOwnProperty.call(data, 'refresh_token')
        ? data.refresh_token
        : undefined,
    })
    return data.access_token
  } catch (error) {
    console.error('Failed to refresh Gmail token:', error)
    return null
  }
}

// --- Outlook DB-based token helpers ---

async function getOutlookTokens(userId) {
  try {
    const data = await getPreferredConnectedAccount({
      userId,
      provider: 'outlook',
      requireAccessToken: true,
    })
    if (!data?.provider_access_token) return null
    return {
      email: data.email || '',
      accessToken: data.provider_access_token,
      refreshToken: data.provider_refresh_token || null,
    }
  } catch (error) {
    console.error('Failed to load Outlook tokens:', error)
    return null
  }
}

async function tryRefreshMicrosoftToken(userId, refreshToken) {
  if (!refreshToken || !process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) return null
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite offline_access',
  })
  try {
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (!data.access_token) return null
    await updateConnectedAccountTokens({
      codePath: 'emails.outlook.refresh',
      userId,
      provider: 'outlook',
      accessToken: data.access_token,
      refreshToken: Object.prototype.hasOwnProperty.call(data, 'refresh_token')
        ? data.refresh_token
        : undefined,
    })
    return data.access_token
  } catch (error) {
    console.error('Failed to refresh Outlook token:', error)
    return null
  }
}

async function fetchGraphJson(url, token, extraHeaders = {}) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } })
  if (!response.ok) {
    const errorText = await response.text()
    const error = new Error(`Microsoft Graph API request failed with status ${response.status}.`)
    error.statusCode = response.status
    error.graphError = errorText
    throw error
  }
  return response.json()
}

function normalizeOutlookMessage(msg) {
  const fromAddress = msg.from?.emailAddress?.address || ''
  const fromName = msg.from?.emailAddress?.name || fromAddress || 'Unknown Sender'
  const receivedDate = msg.receivedDateTime || null
  return {
    id: msg.id,
    subject: msg.subject || '(No Subject)',
    from: fromAddress,
    fromName,
    fromEmail: fromAddress,
    snippet: msg.bodyPreview || '',
    date: receivedDate,
    internalDate: receivedDate ? new Date(receivedDate).getTime() : null,
    isRead: Boolean(msg.isRead),
    conversationId: msg.conversationId || msg.id,
    flagged: msg.flag?.flagStatus === 'flagged',
    hasAttachments: Boolean(msg.hasAttachments),
  }
}

router.get('/outlook', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens

  try {
    const maxResults = Math.min(Number(req.query.maxResults) || 25, 100)
    const skipToken = typeof req.query.skipToken === 'string' ? req.query.skipToken : ''
    const params = new URLSearchParams({
      '$top': String(maxResults),
      '$select': 'id,subject,from,receivedDateTime,bodyPreview,isRead,conversationId,flag,hasAttachments',
      '$orderby': 'receivedDateTime desc',
    })
    if (skipToken) params.set('$skipToken', skipToken)

    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params.toString()}`

    let data
    try {
      data = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          data = await fetchGraphJson(url, freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }

    const messages = Array.isArray(data.value) ? data.value : []
    let nextSkipToken = null
    const nextLink = data['@odata.nextLink'] || ''
    if (nextLink) {
      try { nextSkipToken = new URL(nextLink).searchParams.get('$skipToken') } catch {}
    }

    return res.status(200).json({
      emails: messages.map(normalizeOutlookMessage),
      nextSkipToken: nextSkipToken || null,
    })
  } catch (error) {
    if (error.graphError) {
      console.error('GRAPH API ERROR (inbox):', error.graphError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Outlook messages.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.get('/outlook/sent', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$top=50&$select=id,subject,toRecipients,sentDateTime,bodyPreview,conversationId,hasAttachments&$orderby=sentDateTime%20desc'

    let data
    try {
      data = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          data = await fetchGraphJson(url, freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }

    const messages = Array.isArray(data.value) ? data.value : []
    return res.status(200).json({
      emails: messages.map((msg) => {
        const recipients = Array.isArray(msg.toRecipients)
          ? msg.toRecipients.map((r) => r.emailAddress?.address || '').filter(Boolean).join(', ')
          : ''
        return {
          id: msg.id,
          to: recipients,
          subject: msg.subject || '(No Subject)',
          snippet: msg.bodyPreview || '',
          date: msg.sentDateTime || null,
          internalDate: msg.sentDateTime ? new Date(msg.sentDateTime).getTime() : null,
          conversationId: msg.conversationId || msg.id,
          hasAttachments: Boolean(msg.hasAttachments),
        }
      }),
    })
  } catch (error) {
    if (error.graphError) {
      console.error('GRAPH API ERROR (sent):', error.graphError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Outlook sent emails.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.get('/outlook/drafts', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/Drafts/messages?$top=25&$select=id,subject,toRecipients,lastModifiedDateTime,bodyPreview&$orderby=lastModifiedDateTime%20desc'

    let data
    try {
      data = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          data = await fetchGraphJson(url, freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }

    const messages = Array.isArray(data.value) ? data.value : []
    return res.status(200).json({
      drafts: messages.map((msg) => {
        const recipients = Array.isArray(msg.toRecipients)
          ? msg.toRecipients.map((r) => r.emailAddress?.address || '').filter(Boolean).join(', ')
          : ''
        return {
          id: msg.id,
          to: recipients,
          subject: msg.subject || '(No Subject)',
          snippet: msg.bodyPreview || '',
          date: msg.lastModifiedDateTime || null,
          internalDate: msg.lastModifiedDateTime ? new Date(msg.lastModifiedDateTime).getTime() : null,
        }
      }),
    })
  } catch (error) {
    if (error.graphError) {
      console.error('GRAPH API ERROR (drafts):', error.graphError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Outlook drafts.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.post('/outlook/send', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : []

  if (!to || !body) {
    return res.status(400).json({ message: 'Missing required fields: to, body.' })
  }

  const OUTLOOK_MAX_BYTES = 150 * 1024 * 1024
  for (const att of attachments) {
    const sizeBytes = Math.ceil((att.data?.length || 0) * 3 / 4)
    if (sizeBytes > OUTLOOK_MAX_BYTES) {
      return res.status(400).json({ message: `Attachment "${att.name}" exceeds the 150 MB Outlook limit.` })
    }
  }

  let { accessToken, refreshToken } = tokens

  async function doSend(token) {
    const messagePayload = {
      subject: subject || '(No Subject)',
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    }

    if (attachments.length > 0) {
      messagePayload.attachments = attachments.map((att) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.name || 'attachment',
        contentType: att.mimeType || 'application/octet-stream',
        contentBytes: att.data || '',
      }))
    }

    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: messagePayload, saveToSentItems: true }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error(`Graph sendMail failed: ${response.status}`)
      err.statusCode = response.status
      err.graphError = errorText
      throw err
    }
  }

  try {
    try {
      await doSend(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          await doSend(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to send Outlook email.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.post('/outlook/drafts', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  let { accessToken, refreshToken } = tokens

  async function createDraft(token) {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: subject || '(No Subject)',
        body: { contentType: 'Text', content: body },
        toRecipients: to ? [{ emailAddress: { address: to } }] : [],
      }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error(`Graph POST draft failed: ${response.status}`)
      err.statusCode = response.status
      err.graphError = errorText
      throw err
    }
    return response.json()
  }

  try {
    let data
    try {
      data = await createDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          data = await createDraft(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ success: true, id: data.id })
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to create Outlook draft.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.put('/outlook/drafts/:id', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  let { accessToken, refreshToken } = tokens

  async function updateDraft(token) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: subject || '(No Subject)',
        body: { contentType: 'Text', content: body },
        toRecipients: to ? [{ emailAddress: { address: to } }] : [],
      }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error(`Graph PATCH draft failed: ${response.status}`)
      err.statusCode = response.status
      err.graphError = errorText
      throw err
    }
    return response.json()
  }

  try {
    let data
    try {
      data = await updateDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          data = await updateDraft(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ success: true, id: data.id })
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to update Outlook draft.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.post('/outlook/drafts/:id/send', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens

  async function sendDraft(token) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${req.params.id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' },
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error(`Graph send draft failed: ${response.status}`)
      err.statusCode = response.status
      err.graphError = errorText
      throw err
    }
  }

  try {
    try {
      await sendDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          await sendDraft(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to send Outlook draft.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.delete('/outlook/drafts/:id', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens

  async function deleteDraft(token) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error(`Graph DELETE draft failed: ${response.status}`)
      err.statusCode = response.status
      err.graphError = errorText
      throw err
    }
  }

  try {
    try {
      await deleteDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          await deleteDraft(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to delete Outlook draft.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.get('/outlook/conversation/:conversationId', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens
  const { conversationId } = req.params

  // Refresh token once if needed, then use for all requests
  async function getValidToken() {
    try {
      await fetchGraphJson('https://graph.microsoft.com/v1.0/me?$select=id', accessToken)
      return accessToken
    } catch (err) {
      if (err.statusCode === 401 && refreshToken) {
        const fresh = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (fresh) { accessToken = fresh; return fresh }
      }
      throw err
    }
  }

  try {
    const token = await getValidToken()
    const filterValue = encodeURIComponent(`conversationId eq '${conversationId}'`)
    const select = 'id,subject,from,receivedDateTime,bodyPreview,isRead,conversationId,flag'
    // No $orderby — combining $filter + $orderby can cause Graph API to reject the request;
    // we sort manually after merging. $count=true is required when using $filter on messages.
    const queryString = `$filter=${filterValue}&$top=100&$select=${select}&$count=true`

    // ConsistencyLevel + $count are required for $filter on message collections
    const filterHeaders = { ConsistencyLevel: 'eventual' }

    // Fetch inbox + sent in parallel — folder-specific endpoints support $filter reliably
    const [inboxResult, sentResult] = await Promise.allSettled([
      fetchGraphJson(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${queryString}`, token, filterHeaders),
      fetchGraphJson(`https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?${queryString}`, token, filterHeaders),
    ])

    if (inboxResult.status === 'rejected') console.error('INBOX FILTER ERROR:', inboxResult.reason?.graphError || inboxResult.reason)
    if (sentResult.status === 'rejected') console.error('SENT FILTER ERROR:', sentResult.reason?.graphError || sentResult.reason)

    const inboxMsgs = inboxResult.status === 'fulfilled' ? (inboxResult.value?.value ?? []) : []
    const sentMsgs = sentResult.status === 'fulfilled' ? (sentResult.value?.value ?? []) : []

    if (inboxResult.status === 'rejected' && sentResult.status === 'rejected') {
      return res.status(500).json({ message: 'Failed to fetch conversation from any folder.' })
    }

    // Merge, deduplicate by id, sort ascending by receivedDateTime
    const seenIds = new Set()
    const combined = []
    for (const msg of [...inboxMsgs, ...sentMsgs]) {
      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id)
        combined.push(msg)
      }
    }
    combined.sort((a, b) => new Date(a.receivedDateTime || 0) - new Date(b.receivedDateTime || 0))

    return res.status(200).json({ messages: combined.map(normalizeOutlookMessage) })
  } catch (error) {
    if (error.graphError) {
      console.error('GRAPH API ERROR (conversation):', error.graphError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch conversation.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.patch('/outlook/:id/flag', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens
  const { id } = req.params
  const flagged = Boolean(req.body.flagged)
  const body = JSON.stringify({ flag: { flagStatus: flagged ? 'flagged' : 'notFlagged' } })

  async function patchFlag(token) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok) {
      const errorText = await response.text()
      const error = new Error(`Microsoft Graph API request failed with status ${response.status}.`)
      error.statusCode = response.status
      error.graphError = errorText
      throw error
    }
  }

  try {
    try {
      await patchFlag(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          await patchFlag(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ flagged })
  } catch (error) {
    if (error.graphError) {
      console.error('GRAPH API ERROR (flag):', error.graphError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to update flag.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.get('/outlook/:id', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected or token missing.' })

  let { accessToken, refreshToken } = tokens

  try {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}?$select=id,subject,from,receivedDateTime,bodyPreview,isRead,body,hasAttachments,conversationId,flag`

    let msg
    try {
      msg = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          msg = await fetchGraphJson(url, freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }

    const normalized = normalizeOutlookMessage(msg)
    const isHtml = msg.body?.contentType?.toLowerCase() === 'html'
    const bodyHtml = isHtml ? (msg.body?.content || '') : ''
    const bodyText = !isHtml
      ? (msg.body?.content || '')
      : (bodyHtml ? stripHtml(bodyHtml) : normalized.snippet)

    let attachments = []
    if (msg.hasAttachments) {
      try {
        const attData = await fetchGraphJson(
          `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}/attachments?$select=id,name,contentType,size`,
          accessToken
        )
        attachments = (Array.isArray(attData.value) ? attData.value : []).map((a) => ({
          attachmentId: a.id,
          filename: a.name || 'attachment',
          mimeType: a.contentType || 'application/octet-stream',
          size: a.size || 0,
        }))
      } catch {
        // Non-fatal: attachment list unavailable
      }
    }

    return res.status(200).json({ ...normalized, bodyText, bodyHtml, attachments })
  } catch (error) {
    if (error.graphError) {
      console.error('GRAPH API ERROR (detail):', error.graphError)
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Outlook message.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.get('/outlook/:id/attachments/:attachmentId', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected.' })

  let { accessToken, refreshToken } = tokens

  async function fetchAtt(token) {
    return fetchGraphJson(
      `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}/attachments/${req.params.attachmentId}`,
      token
    )
  }

  try {
    let attachment
    try {
      attachment = await fetchAtt(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          attachment = await fetchAtt(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }

    const buffer = Buffer.from(attachment.contentBytes || '', 'base64')
    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream')
    res.setHeader('Content-Length', buffer.length)
    return res.send(buffer)
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to fetch Outlook attachment.', graph_error: error.graphError })
    }
    return next(error)
  }
})

router.patch('/outlook/:id/read', async (req, res, next) => {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) return res.status(401).json({ message: 'Invalid authorization.' })

  const tokens = await getOutlookTokens(userId)
  if (!tokens) return res.status(401).json({ message: 'Outlook account not connected.' })

  const read = Boolean(req.body?.read)
  let { accessToken, refreshToken } = tokens

  async function patchIsRead(token) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: read }),
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err = new Error(`Graph PATCH failed: ${response.status}`)
      err.statusCode = response.status
      err.graphError = errorText
      throw err
    }
  }

  try {
    try {
      await patchIsRead(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const freshToken = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (freshToken) {
          await patchIsRead(freshToken)
        } else {
          throw graphError
        }
      } else {
        throw graphError
      }
    }
    return res.status(200).json({ ok: true, read })
  } catch (error) {
    if (error.graphError) {
      return res.status(error.statusCode || 500).json({ message: 'Failed to update Outlook read state.', graph_error: error.graphError })
    }
    return next(error)
  }
})

module.exports = router
