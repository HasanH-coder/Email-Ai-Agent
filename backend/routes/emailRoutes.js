const express = require('express')
const supabaseAdmin = require('../config/supabase')
const {
  getPreferredConnectedAccount,
  updateConnectedAccountTokens,
} = require('../utils/connectedAccounts')

const router = express.Router()
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const PROVIDER_API_MAX_RETRIES = 2
const PROVIDER_API_BASE_BACKOFF_MS = 250
const PROVIDER_API_TIMEOUT_MS = 15000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTokenNearExpiry(tokenExpiresAt, bufferMs = TOKEN_REFRESH_BUFFER_MS) {
  if (!tokenExpiresAt) return false
  const expiresAtMs = new Date(tokenExpiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return false
  return expiresAtMs - Date.now() <= bufferMs
}

function createProviderApiError(provider, statusCode, providerErrorText, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  if (provider === 'gmail') {
    error.gmailError = providerErrorText
  } else {
    error.graphError = providerErrorText
  }
  return error
}

function isTemporaryProviderStatus(statusCode) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500
}

function isTemporaryProviderError(error) {
  if (!error) return false
  if (isTemporaryProviderStatus(error.statusCode)) return true
  if (error.name === 'AbortError') return true
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'UND_ERR_CONNECT_TIMEOUT') {
    return true
  }
  return error instanceof TypeError
}

function isReconnectRequiredRefreshFailure(statusCode, errorText = '') {
  if (statusCode !== 400 && statusCode !== 401) return false
  const normalized = String(errorText).toLowerCase()
  return (
    normalized.includes('invalid_grant') ||
    normalized.includes('invalid_token') ||
    normalized.includes('revoked') ||
    normalized.includes('expired') ||
    normalized.includes('interaction_required') ||
    normalized.includes('consent_required')
  )
}

function createReconnectRequiredError(provider, providerErrorText = '') {
  const error = new Error('Account needs reconnection')
  error.statusCode = 401
  error.reconnectRequired = true
  error.provider = provider
  if (provider === 'gmail') {
    error.gmailError = providerErrorText || 'Account needs reconnection'
  } else {
    error.graphError = providerErrorText || 'Account needs reconnection'
  }
  return error
}

function logProviderRetry(provider, requestLabel, attempt, error) {
  console.warn(`[${provider}] temporary API failure, retrying`, {
    request: requestLabel,
    attempt,
    statusCode: error?.statusCode || null,
    errorName: error?.name || null,
    reconnectRequired: Boolean(error?.reconnectRequired),
  })
}

function sendProviderError(res, provider, error, message) {
  const payload = {
    message: error?.reconnectRequired ? 'Account needs reconnection' : message,
    reconnectRequired: Boolean(error?.reconnectRequired),
    provider,
  }

  if (provider === 'gmail' && error?.gmailError) {
    payload.gmail_error = error.gmailError
  }
  if (provider === 'outlook' && error?.graphError) {
    payload.graph_error = error.graphError
  }

  if (error?.reconnectRequired) {
    console.warn(`[${provider}] account needs reconnection`, {
      statusCode: error?.statusCode || 401,
    })
  }

  return res.status(error?.statusCode || 500).json(payload)
}

async function performProviderFetch({
  provider,
  requestLabel,
  url,
  options = {},
  responseType = 'json',
}) {
  for (let attempt = 0; attempt <= PROVIDER_API_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROVIDER_API_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        const error = createProviderApiError(
          provider,
          response.status,
          errorText,
          `${provider} API request failed with status ${response.status}.`
        )

        if (attempt < PROVIDER_API_MAX_RETRIES && isTemporaryProviderError(error)) {
          logProviderRetry(provider, requestLabel, attempt + 1, error)
          await sleep(PROVIDER_API_BASE_BACKOFF_MS * (2 ** attempt))
          continue
        }

        throw error
      }

      if (responseType === 'response') {
        return response
      }
      if (responseType === 'text') {
        return response.text()
      }
      return response.json()
    } catch (error) {
      if (attempt < PROVIDER_API_MAX_RETRIES && isTemporaryProviderError(error)) {
        logProviderRetry(provider, requestLabel, attempt + 1, error)
        await sleep(PROVIDER_API_BASE_BACKOFF_MS * (2 ** attempt))
        continue
      }

      if (error.name === 'AbortError') {
        throw createProviderApiError(provider, 408, 'Provider API request timed out.', `${provider} API request timed out.`)
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  throw new Error('Unreachable provider fetch retry state.')
}

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
  return performProviderFetch({
    provider: 'gmail',
    requestLabel: 'gmail.json',
    url,
    options: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    responseType: 'json',
  })
}

async function fetchGmailResponse(url, token, options = {}) {
  return performProviderFetch({
    provider: 'gmail',
    requestLabel: 'gmail.response',
    url,
    options: {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    },
    responseType: 'response',
  })
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
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
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
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          listData = await fetchGmailJson(url, refreshed.accessToken)
        }
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
      return sendProviderError(res, 'gmail', error, 'Failed to fetch Gmail messages.')
    }
    return next(error)
  }
})

router.get('/gmail/inbox-meta', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const unreadUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is:unread&maxResults=1'
    let unreadData
    try {
      await fetchGmailJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', accessToken)
      unreadData = await fetchGmailJson(unreadUrl, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          await fetchGmailJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', accessToken)
          unreadData = await fetchGmailJson(unreadUrl, accessToken)
        } else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ unreadInboxCount: Number(unreadData.resultSizeEstimate) || 0 })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to fetch Gmail inbox metadata.')
    }
    return next(error)
  }
})

router.get('/gmail/sent', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=50'
    let listData
    try {
      listData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          listData = await fetchGmailJson(url, refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    const messages = Array.isArray(listData.messages) ? listData.messages : []
    const emailItems = await fetchGmailMessagesByIds(messages.map(({ id }) => id), accessToken)
    return res.status(200).json({ emails: emailItems })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to fetch Gmail sent emails.')
    }
    return next(error)
  }
})

router.get('/gmail/drafts', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=25'
    let listData
    try {
      listData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          listData = await fetchGmailJson(url, refreshed.accessToken)
        }
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
      return sendProviderError(res, 'gmail', error, 'Failed to fetch Gmail drafts.')
    }
    return next(error)
  }
})

router.post('/gmail/send', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
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
    return performProviderFetch({
      provider: 'gmail',
      requestLabel: 'gmail.send',
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodeBase64Url(rawEmail) }),
      },
      responseType: 'json',
    })
  }

  try {
    let responseData
    try {
      responseData = await doSend(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          responseData = await doSend(refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL SEND ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to send Gmail email.')
    }
    return next(error)
  }
})

router.post('/gmail/drafts', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  async function doCreate(tok) {
    const userEmail = await fetchGmailProfileEmail(tok)
    const raw = encodeBase64Url(buildRawEmail({ from: userEmail, to, subject, body }))
    return performProviderFetch({
      provider: 'gmail',
      requestLabel: 'gmail.createDraft',
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw } }),
      },
      responseType: 'json',
    })
  }

  try {
    let responseData
    try {
      responseData = await doCreate(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          responseData = await doCreate(refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id, message: responseData.message })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT CREATE ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to create Gmail draft.')
    }
    return next(error)
  }
})

router.put('/gmail/drafts/:id', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()
  const draftId = req.params.id

  async function doUpdate(tok) {
    const userEmail = await fetchGmailProfileEmail(tok)
    const raw = encodeBase64Url(buildRawEmail({ from: userEmail, to, subject, body }))
    return performProviderFetch({
      provider: 'gmail',
      requestLabel: 'gmail.updateDraft',
      url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`,
      options: {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId, message: { raw } }),
      },
      responseType: 'json',
    })
  }

  try {
    let responseData
    try {
      responseData = await doUpdate(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          responseData = await doUpdate(refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id, message: responseData.message })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT UPDATE ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to update Gmail draft.')
    }
    return next(error)
  }
})

router.post('/gmail/drafts/:id/send', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  async function doSendDraft(tok) {
    return performProviderFetch({
      provider: 'gmail',
      requestLabel: 'gmail.sendDraft',
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.params.id }),
      },
      responseType: 'json',
    })
  }

  try {
    let responseData
    try {
      responseData = await doSendDraft(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          responseData = await doSendDraft(refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true, id: responseData.id, threadId: responseData.threadId })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT SEND ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to send Gmail draft.')
    }
    return next(error)
  }
})

router.delete('/gmail/drafts/:id', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  async function doDelete(tok) {
    await performProviderFetch({
      provider: 'gmail',
      requestLabel: 'gmail.deleteDraft',
      url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${req.params.id}`,
      options: {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok}` },
      },
      responseType: 'response',
    })
  }

  try {
    try {
      await doDelete(accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await doDelete(refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL DRAFT DELETE ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to delete Gmail draft.')
    }
    return next(error)
  }
})

router.get('/gmail/:id', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}`
    let messageData
    try {
      messageData = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          messageData = await fetchGmailJson(url, refreshed.accessToken)
        }
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
      return sendProviderError(res, 'gmail', error, 'Failed to fetch Gmail message.')
    }
    return next(error)
  }
})

router.patch('/gmail/:id/read', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
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
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await fetchGmailResponse(url, refreshed.accessToken, opts)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ ok: true, read })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to update Gmail read state.')
    }
    return next(error)
  }
})

router.patch('/gmail/:id/star', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
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
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await fetchGmailResponse(url, refreshed.accessToken, opts)
        }
        else throw gmailError
      } else throw gmailError
    }
    return res.status(200).json({ ok: true, starred })
  } catch (error) {
    if (error.gmailError) {
      console.error('GMAIL API ERROR:', error.gmailError)
      return sendProviderError(res, 'gmail', error, 'Failed to update Gmail star state.')
    }
    return next(error)
  }
})

router.get('/gmail/:id/attachments/:attachmentId', async (req, res, next) => {
  const authContext = await getAuthorizedGmailContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/attachments/${req.params.attachmentId}`
    let data
    try {
      data = await fetchGmailJson(url, accessToken)
    } catch (gmailError) {
      if (gmailError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshGoogleToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          data = await fetchGmailJson(url, refreshed.accessToken)
        }
        else throw gmailError
      } else throw gmailError
    }
    const buffer = Buffer.from((data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', buffer.length)
    return res.send(buffer)
  } catch (error) {
    if (error.gmailError) {
      return sendProviderError(res, 'gmail', error, 'Failed to fetch Gmail attachment.')
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
      tokenExpiresAt: data.provider_token_expires_at || null,
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
    if (!response.ok) {
      const errorText = await response.text()
      if (isReconnectRequiredRefreshFailure(response.status, errorText)) {
        throw createReconnectRequiredError('gmail', errorText)
      }
      console.warn('[gmail] token refresh failed', {
        statusCode: response.status,
      })
      return null
    }
    const data = await response.json()
    if (!data.access_token) return null
    const tokenExpiresAt =
      Object.prototype.hasOwnProperty.call(data, 'expires_in') && Number.isFinite(Number(data.expires_in))
        ? new Date(Date.now() + Number(data.expires_in) * 1000)
        : undefined
    await updateConnectedAccountTokens({
      codePath: 'emails.gmail.refresh',
      userId,
      provider: 'gmail',
      accessToken: data.access_token,
      refreshToken: Object.prototype.hasOwnProperty.call(data, 'refresh_token')
        ? data.refresh_token
        : undefined,
      tokenExpiresAt,
    })
    return {
      accessToken: data.access_token,
      refreshToken: Object.prototype.hasOwnProperty.call(data, 'refresh_token')
        ? data.refresh_token
        : refreshToken,
      tokenExpiresAt: tokenExpiresAt ? tokenExpiresAt.toISOString() : null,
    }
  } catch (error) {
    console.error('Failed to refresh Gmail token:', error)
    if (error.reconnectRequired) throw error
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
      tokenExpiresAt: data.provider_token_expires_at || null,
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
    if (!response.ok) {
      const errorText = await response.text()
      if (isReconnectRequiredRefreshFailure(response.status, errorText)) {
        throw createReconnectRequiredError('outlook', errorText)
      }
      console.warn('[outlook] token refresh failed', {
        statusCode: response.status,
      })
      return null
    }
    const data = await response.json()
    if (!data.access_token) return null
    const tokenExpiresAt =
      Object.prototype.hasOwnProperty.call(data, 'expires_in') && Number.isFinite(Number(data.expires_in))
        ? new Date(Date.now() + Number(data.expires_in) * 1000)
        : undefined
    await updateConnectedAccountTokens({
      codePath: 'emails.outlook.refresh',
      userId,
      provider: 'outlook',
      accessToken: data.access_token,
      refreshToken: Object.prototype.hasOwnProperty.call(data, 'refresh_token')
        ? data.refresh_token
        : undefined,
      tokenExpiresAt,
    })
    return {
      accessToken: data.access_token,
      refreshToken: Object.prototype.hasOwnProperty.call(data, 'refresh_token')
        ? data.refresh_token
        : refreshToken,
      tokenExpiresAt: tokenExpiresAt ? tokenExpiresAt.toISOString() : null,
    }
  } catch (error) {
    console.error('Failed to refresh Outlook token:', error)
    if (error.reconnectRequired) throw error
    return null
  }
}

async function getUsableGmailTokens(userId) {
  const tokens = await getGmailTokens(userId)
  if (!tokens) return null

  if (tokens.tokenExpiresAt && isTokenNearExpiry(tokens.tokenExpiresAt) && tokens.refreshToken) {
    console.info('[gmail] access token near expiry, proactively refreshing', {
      user_id: userId,
      email: tokens.email || null,
    })
    const refreshed = await tryRefreshGoogleToken(userId, tokens.refreshToken)
    if (refreshed?.accessToken) {
      return {
        ...tokens,
        ...refreshed,
      }
    }
  }

  return tokens
}

async function getUsableOutlookTokens(userId) {
  const tokens = await getOutlookTokens(userId)
  if (!tokens) return null

  if (tokens.tokenExpiresAt && isTokenNearExpiry(tokens.tokenExpiresAt) && tokens.refreshToken) {
    console.info('[outlook] access token near expiry, proactively refreshing', {
      user_id: userId,
      email: tokens.email || null,
    })
    const refreshed = await tryRefreshMicrosoftToken(userId, tokens.refreshToken)
    if (refreshed?.accessToken) {
      return {
        ...tokens,
        ...refreshed,
      }
    }
  }

  return tokens
}

async function getAuthorizedGmailContext(req, res) {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ message: 'Invalid authorization.' })
    return null
  }

  try {
    const tokens = await getUsableGmailTokens(userId)
    if (!tokens) {
      res.status(401).json({ message: 'Gmail account not connected or token missing.' })
      return null
    }
    return { userId, tokens }
  } catch (error) {
    if (error.reconnectRequired) {
      sendProviderError(res, 'gmail', error, 'Failed to authorize Gmail account.')
      return null
    }
    throw error
  }
}

async function getAuthorizedOutlookContext(req, res) {
  const userId = await getUserIdFromSupabaseToken(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ message: 'Invalid authorization.' })
    return null
  }

  try {
    const tokens = await getUsableOutlookTokens(userId)
    if (!tokens) {
      res.status(401).json({ message: 'Outlook account not connected or token missing.' })
      return null
    }
    return { userId, tokens }
  } catch (error) {
    if (error.reconnectRequired) {
      sendProviderError(res, 'outlook', error, 'Failed to authorize Outlook account.')
      return null
    }
    throw error
  }
}

async function fetchGraphJson(url, token, extraHeaders = {}) {
  return performProviderFetch({
    provider: 'outlook',
    requestLabel: 'outlook.json',
    url,
    options: {
      headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
    },
    responseType: 'json',
  })
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
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
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
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          data = await fetchGraphJson(url, refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to fetch Outlook messages.')
    }
    return next(error)
  }
})

router.get('/outlook/sent', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$top=50&$select=id,subject,toRecipients,sentDateTime,bodyPreview,conversationId,hasAttachments&$orderby=sentDateTime%20desc'

    let data
    try {
      data = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          data = await fetchGraphJson(url, refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to fetch Outlook sent emails.')
    }
    return next(error)
  }
})

router.get('/outlook/drafts', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext
  let { accessToken, refreshToken } = tokens

  try {
    const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/Drafts/messages?$top=25&$select=id,subject,toRecipients,lastModifiedDateTime,bodyPreview&$orderby=lastModifiedDateTime%20desc'

    let data
    try {
      data = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          data = await fetchGraphJson(url, refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to fetch Outlook drafts.')
    }
    return next(error)
  }
})

router.post('/outlook/send', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

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

    await performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.sendMail',
      url: 'https://graph.microsoft.com/v1.0/me/sendMail',
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messagePayload, saveToSentItems: true }),
      },
      responseType: 'response',
    })
  }

  try {
    try {
      await doSend(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await doSend(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to send Outlook email.')
    }
    return next(error)
  }
})

router.post('/outlook/drafts', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  let { accessToken, refreshToken } = tokens

  async function createDraft(token) {
    return performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.createDraft',
      url: 'https://graph.microsoft.com/v1.0/me/messages',
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject || '(No Subject)',
          body: { contentType: 'Text', content: body },
          toRecipients: to ? [{ emailAddress: { address: to } }] : [],
        }),
      },
      responseType: 'json',
    })
  }

  try {
    let data
    try {
      data = await createDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          data = await createDraft(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to create Outlook draft.')
    }
    return next(error)
  }
})

router.put('/outlook/drafts/:id', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  const to = String(req.body?.to || '').trim()
  const subject = String(req.body?.subject || '').trim()
  const body = String(req.body?.body || '').trim()

  let { accessToken, refreshToken } = tokens

  async function updateDraft(token) {
    return performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.updateDraft',
      url: `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
      options: {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject || '(No Subject)',
          body: { contentType: 'Text', content: body },
          toRecipients: to ? [{ emailAddress: { address: to } }] : [],
        }),
      },
      responseType: 'json',
    })
  }

  try {
    let data
    try {
      data = await updateDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          data = await updateDraft(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to update Outlook draft.')
    }
    return next(error)
  }
})

router.post('/outlook/drafts/:id/send', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  let { accessToken, refreshToken } = tokens

  async function sendDraft(token) {
    await performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.sendDraft',
      url: `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}/send`,
      options: {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' },
      },
      responseType: 'response',
    })
  }

  try {
    try {
      await sendDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await sendDraft(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to send Outlook draft.')
    }
    return next(error)
  }
})

router.delete('/outlook/drafts/:id', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  let { accessToken, refreshToken } = tokens

  async function deleteDraft(token) {
    await performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.deleteDraft',
      url: `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
      options: {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      responseType: 'response',
    })
  }

  try {
    try {
      await deleteDraft(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await deleteDraft(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to delete Outlook draft.')
    }
    return next(error)
  }
})

router.get('/outlook/conversation/:conversationId', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  let { accessToken, refreshToken } = tokens
  const { conversationId } = req.params

  // Refresh token once if needed, then use for all requests
  async function getValidToken() {
    try {
      await fetchGraphJson('https://graph.microsoft.com/v1.0/me?$select=id', accessToken)
      return accessToken
    } catch (err) {
      if (err.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          return refreshed.accessToken
        }
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
      return sendProviderError(res, 'outlook', error, 'Failed to fetch conversation.')
    }
    return next(error)
  }
})

router.patch('/outlook/:id/flag', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  let { accessToken, refreshToken } = tokens
  const { id } = req.params
  const flagged = Boolean(req.body.flagged)
  const body = JSON.stringify({ flag: { flagStatus: flagged ? 'flagged' : 'notFlagged' } })

  async function patchFlag(token) {
    await performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.flag',
      url: `https://graph.microsoft.com/v1.0/me/messages/${id}`,
      options: {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      },
      responseType: 'response',
    })
  }

  try {
    try {
      await patchFlag(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await patchFlag(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to update flag.')
    }
    return next(error)
  }
})

router.get('/outlook/:id', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  let { accessToken, refreshToken } = tokens

  try {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}?$select=id,subject,from,receivedDateTime,bodyPreview,isRead,body,hasAttachments,conversationId,flag`

    let msg
    try {
      msg = await fetchGraphJson(url, accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken
          refreshToken = refreshed.refreshToken || refreshToken
          msg = await fetchGraphJson(url, refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to fetch Outlook message.')
    }
    return next(error)
  }
})

router.get('/outlook/:id/attachments/:attachmentId', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

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
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          attachment = await fetchAtt(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to fetch Outlook attachment.')
    }
    return next(error)
  }
})

router.patch('/outlook/:id/read', async (req, res, next) => {
  const authContext = await getAuthorizedOutlookContext(req, res)
  if (!authContext) return
  const { userId, tokens } = authContext

  const read = Boolean(req.body?.read)
  let { accessToken, refreshToken } = tokens

  async function patchIsRead(token) {
    await performProviderFetch({
      provider: 'outlook',
      requestLabel: 'outlook.read',
      url: `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
      options: {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: read }),
      },
      responseType: 'response',
    })
  }

  try {
    try {
      await patchIsRead(accessToken)
    } catch (graphError) {
      if (graphError.statusCode === 401 && refreshToken) {
        const refreshed = await tryRefreshMicrosoftToken(userId, refreshToken)
        if (refreshed?.accessToken) {
          refreshToken = refreshed.refreshToken || refreshToken
          await patchIsRead(refreshed.accessToken)
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
      return sendProviderError(res, 'outlook', error, 'Failed to update Outlook read state.')
    }
    return next(error)
  }
})

module.exports = router
