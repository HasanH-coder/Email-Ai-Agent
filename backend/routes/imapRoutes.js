const express = require('express')
const { ImapFlow } = require('imapflow')
const { simpleParser } = require('mailparser')
const nodemailer = require('nodemailer')
const supabaseAdmin = require('../config/supabase')
const authMiddleware = require('../middleware/authMiddleware')

const router = express.Router()
const IMAP_TIMEOUT_MS = 8000
const SENT_PAGE_SIZE = 50

function createImapClient({ host, port, email, password }) {
  return new ImapFlow({
    host,
    port: Number(port),
    secure: Number(port) === 993,
    auth: { user: email, pass: password },
    logger: false,
  })
}

function withTimeout(promise, ms, message) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message || `Timed out after ${ms}ms`)), ms)
  )
  return Promise.race([promise, timeout])
}

// ---------------------------------------------------------------------------
// Connection pool — eliminates per-request TCP + TLS + auth overhead.
// Each user keeps one warm connection reused across requests.
// - POOL_IDLE_MS: evict after 10 minutes of no requests (server-side idle limit is typically 30m)
// - KEEPALIVE_MS: send IMAP NOOP every 4 minutes to prevent server-side disconnection
// - On any connection error, evict the stale entry and reconnect automatically using
//   credentials stored in Supabase (called on every request, so Railway restarts are safe)
// ---------------------------------------------------------------------------
const imapPool = new Map()
const POOL_IDLE_MS = 10 * 60 * 1000   // 10 minutes idle before eviction
const KEEPALIVE_MS = 4 * 60 * 1000    // NOOP ping every 4 minutes

function evictFromPool(key) {
  const entry = imapPool.get(key)
  if (!entry) return
  imapPool.delete(key)
  if (entry.keepaliveInterval) clearInterval(entry.keepaliveInterval)
  if (entry.timer) clearTimeout(entry.timer)
  try { entry.client.logout() } catch { try { entry.client.close() } catch {} }
}

function startKeepalive(key, client) {
  return setInterval(async () => {
    const entry = imapPool.get(key)
    if (!entry) return
    try {
      await client.noop()
    } catch {
      // Connection is dead — evict so the next request triggers a fresh connect
      evictFromPool(key)
    }
  }, KEEPALIVE_MS)
}

function isConnectionError(err) {
  const msg = err?.message || ''
  return (
    msg.includes('Connection closed') ||
    msg.includes('Not connected') ||
    msg.includes('socket') ||
    msg.includes('ECONNRESET') ||
    msg.includes('EPIPE') ||
    msg.includes('ENOTCONN') ||
    msg.includes('timed out') ||
    msg.includes('Timed out') ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'EPIPE' ||
    err?.code === 'ENOTCONN'
  )
}

// Runs fn(client) on a pooled IMAP connection for this user.
// - If a warm connection exists, reuses it (avoids TCP + TLS + auth round-trips).
// - Keepalive NOOPs prevent server-side disconnection during inactivity.
// - On a connection error, evicts the stale entry and retries once with a fresh connection.
// - Credentials are read from Supabase on every request, so Railway restarts reconnect automatically.
async function withImapConnection(creds, userId, fn) {
  const key = `${userId}:${creds.email}`
  let entry = imapPool.get(key)

  if (entry) {
    // Pause idle eviction timer during the request
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null }
    try {
      const result = await fn(entry.client)
      // Reset idle eviction timer after successful request
      entry.timer = setTimeout(() => evictFromPool(key), POOL_IDLE_MS)
      return result
    } catch (err) {
      if (isConnectionError(err)) {
        // Stale pooled connection — evict and fall through to create a fresh one
        try { entry.client.close() } catch {}
        if (entry.keepaliveInterval) clearInterval(entry.keepaliveInterval)
        imapPool.delete(key)
      } else {
        // Application error — keep the connection alive, just re-throw
        entry.timer = setTimeout(() => evictFromPool(key), POOL_IDLE_MS)
        throw err
      }
    }
  }

  // No usable pooled connection — create a fresh one (auto-reconnect after drop or restart)
  const client = createImapClient({
    host: creds.imap_host, port: creds.imap_port, email: creds.email, password: creds.password,
  })
  await withTimeout(client.connect(), IMAP_TIMEOUT_MS, 'Connection timed out.')

  const newEntry = {
    client,
    timer: null,
    keepaliveInterval: startKeepalive(key, client),
  }
  imapPool.set(key, newEntry)

  try {
    const result = await fn(client)
    newEntry.timer = setTimeout(() => evictFromPool(key), POOL_IDLE_MS)
    return result
  } catch (err) {
    evictFromPool(key)
    throw err
  }
}

async function getImapCredentials(userId) {
  const { data, error } = await supabaseAdmin
    .from('connected_accounts')
    .select('email, provider_access_token')
    .eq('user_id', userId)
    .eq('provider', 'imap')
    .not('provider_access_token', 'is', null)
    .limit(1)
    .single()

  if (error || !data) return null

  try {
    const creds = JSON.parse(data.provider_access_token)
    return {
      email: data.email,
      password: creds.password,
      imap_host: creds.imap_host,
      imap_port: Number(creds.imap_port) || 993,
      smtp_host: creds.smtp_host || '',
      smtp_port: Number(creds.smtp_port) || 587,
    }
  } catch {
    return null
  }
}

// Build an RFC822 MIME message suitable for IMAP APPEND.
// Produces multipart/mixed when attachments are provided, plain text otherwise.
function buildRawMimeMessage({ from, to, subject = '(No Subject)', body = '', inReplyTo = null, attachments = [] }) {
  const date = new Date().toUTCString()

  if (attachments.length === 0) {
    const lines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ]
    if (inReplyTo) {
      lines.push(`In-Reply-To: ${inReplyTo}`)
      lines.push(`References: ${inReplyTo}`)
    }
    lines.push('')
    lines.push(body)
    return lines.join('\r\n')
  }

  const boundary = 'boundary_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2)
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`)
    lines.push(`References: ${inReplyTo}`)
  }
  lines.push('')
  lines.push(`--${boundary}`)
  lines.push('Content-Type: text/plain; charset=utf-8')
  lines.push('Content-Transfer-Encoding: 8bit')
  lines.push('')
  lines.push(body)
  for (const att of attachments) {
    const safeFilename = (att.name || 'attachment').replace(/"/g, '')
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${safeFilename}"`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push(`Content-Disposition: attachment; filename="${safeFilename}"`)
    lines.push('')
    const b64 = att.data || ''
    for (let i = 0; i < b64.length; i += 76) {
      lines.push(b64.slice(i, i + 76))
    }
  }
  lines.push(`--${boundary}--`)
  return lines.join('\r\n')
}

// Build a list-view email object from an imapflow message.
function buildEmailObject(msg, snippet) {
  const from = msg.envelope?.from?.[0]
  const fromEmail = from?.address || ''
  const fromName = from?.name || fromEmail

  const toEntry = msg.envelope?.to?.[0]
  const toEmail = toEntry?.address || ''
  const toName = toEntry?.name || toEmail
  const to = toName && toName !== toEmail ? `${toName} <${toEmail}>` : toEmail

  const date = msg.envelope?.date
  return {
    id: String(msg.uid),
    from: fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail,
    fromName: fromName || 'Unknown Sender',
    fromEmail,
    to,
    subject: msg.envelope?.subject || '(no subject)',
    snippet,
    bodyText: snippet,
    bodyHtml: '',
    internalDate: date ? String(date.getTime()) : '',
    date: date ? date.toISOString() : '',
    read: msg.flags.has('\\Seen'),
    starred: msg.flags.has('\\Flagged'),
  }
}

// ---------------------------------------------------------------------------
// POST /api/emails/imap/test
// ---------------------------------------------------------------------------
router.post('/test', authMiddleware, async (req, res) => {
  const { email, password, imap_host, imap_port } = req.body

  if (!email || !password || !imap_host || !imap_port) {
    return res.status(400).json({ ok: false, message: 'Missing required fields.' })
  }

  // Use a one-off client (not the pool) — credentials aren't persisted yet.
  const client = createImapClient({ host: imap_host, port: imap_port, email, password })

  try {
    await withTimeout(
      client.connect().then(() => client.logout()),
      IMAP_TIMEOUT_MS,
      'Connection timed out. Please check your server settings.'
    )
    return res.json({ ok: true })
  } catch (err) {
    console.error('[imap] test connection failed:', err.message)
    try { client.close() } catch {}
    const isTimeout = err.message.includes('timed out') || err.message.includes('Timed out')
    return res.status(400).json({
      ok: false,
      message: isTimeout
        ? 'Connection timed out. Please check your server settings.'
        : 'Could not connect to IMAP server. Please check your credentials and server settings.',
    })
  }
})

// ---------------------------------------------------------------------------
// POST /api/emails/imap/send
// Bug 1 fix: return the HTTP response immediately after SMTP succeeds, then
// append the copy to the Sent folder in the background via the pool.
// ---------------------------------------------------------------------------
router.post('/send', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const { to, subject, body, inReplyTo } = req.body
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : []

  if (!to || !body) {
    return res.status(400).json({ message: 'Missing required fields: to, body.' })
  }

  const IMAP_MAX_BYTES = 25 * 1024 * 1024
  for (const att of attachments) {
    const sizeBytes = Math.ceil((att.data?.length || 0) * 3 / 4)
    if (sizeBytes > IMAP_MAX_BYTES) {
      return res.status(400).json({ message: `Attachment "${att.name}" exceeds the 25 MB limit.` })
    }
  }

  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })
  if (!creds.smtp_host) {
    return res.status(400).json({ message: 'SMTP not configured. Please reconnect your IMAP account with SMTP settings.' })
  }

  const mailOptions = {
    from: creds.email,
    to,
    subject: subject || '(No Subject)',
    text: body,
  }
  if (inReplyTo) {
    mailOptions.inReplyTo = inReplyTo
    mailOptions.references = inReplyTo
  }
  if (attachments.length > 0) {
    mailOptions.attachments = attachments.map((att) => ({
      filename: att.name || 'attachment',
      content: Buffer.from(att.data || '', 'base64'),
      contentType: att.mimeType || 'application/octet-stream',
    }))
  }

  function buildSmtpTransporter(port) {
    return nodemailer.createTransport({
      host: creds.smtp_host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user: creds.email, pass: creds.password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  }

  const primaryPort = Number(creds.smtp_port) || 587
  const fallbackPort = primaryPort === 465 ? 587 : primaryPort === 587 ? 465 : null

  let smtpError = null
  let sent = false

  // Try primary port
  try {
    await buildSmtpTransporter(primaryPort).sendMail(mailOptions)
    sent = true
  } catch (err) {
    smtpError = err
    console.error('[imap] SMTP send failed on primary port', {
      host: creds.smtp_host,
      port: primaryPort,
      code: err.code,
      message: err.message,
    })
  }

  // Try fallback port if primary failed
  if (!sent && fallbackPort) {
    try {
      await buildSmtpTransporter(fallbackPort).sendMail(mailOptions)
      sent = true
      console.log(`[imap] SMTP succeeded on fallback port ${fallbackPort} (primary port ${primaryPort} failed: ${smtpError?.message})`)
    } catch (fallbackErr) {
      console.error('[imap] SMTP send also failed on fallback port', {
        host: creds.smtp_host,
        port: fallbackPort,
        code: fallbackErr.code,
        message: fallbackErr.message,
      })
      smtpError = new Error(
        `Port ${primaryPort}: ${smtpError?.message} | Port ${fallbackPort}: ${fallbackErr.message}`
      )
    }
  }

  if (!sent) {
    return res.status(500).json({
      message: `Failed to send email via SMTP. ${smtpError?.message || 'Unknown error'}`,
      smtp: { host: creds.smtp_host, port: primaryPort, fallbackPort },
    })
  }

  // Respond immediately — the SMTP delivery is complete.
  res.json({ ok: true })

  // Append a copy to the Sent folder using a dedicated one-off IMAP connection.
  // A separate client avoids any state conflicts with the shared pool (e.g. INBOX
  // being selected by a concurrent request). mailboxOpen() is called before append()
  // so the server accepts the APPEND command regardless of prior mailbox state.
  const sentRaw = buildRawMimeMessage({
    from: creds.email, to, subject: subject || '(No Subject)', body,
    inReplyTo: inReplyTo || null, attachments,
  })
  setImmediate(async () => {
    const appendClient = createImapClient({
      host: creds.imap_host, port: creds.imap_port,
      email: creds.email, password: creds.password,
    })
    try {
      await withTimeout(appendClient.connect(), IMAP_TIMEOUT_MS, 'Connection timed out.')
      const sentFolders = ['Sent', 'Sent Items', 'INBOX.Sent', '[Gmail]/Sent Mail']
      let appended = false
      for (const folder of sentFolders) {
        try {
          await appendClient.mailboxOpen(folder)
          await appendClient.append(folder, Buffer.from(sentRaw), ['\\Seen'])
          appended = true
          break
        } catch {
          continue
        }
      }
      if (!appended) {
        console.error('[imap] Could not append sent message — no writable Sent folder found. Tried:', sentFolders.join(', '))
      }
    } catch (err) {
      console.error('[imap] Background Sent-folder append failed:', err.message)
    } finally {
      try { await appendClient.logout() } catch { try { appendClient.close() } catch {} }
    }
  })
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap?skip=N  — inbox list (envelope + flags only)
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const skip = Math.max(0, parseInt(req.query.skip) || 0)
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const { emails, hasMore } = await withImapConnection(creds, userId, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      const rawMessages = []
      let hasMore = false
      try {
        const messageCount = client.mailbox.exists || 0
        if (messageCount > 0) {
          const end = Math.max(1, messageCount - skip)
          const start = Math.max(1, end - 24)
          hasMore = start > 1
          for await (const msg of client.fetch(`${start}:${end}`, { envelope: true, flags: true, uid: true })) {
            rawMessages.push(msg)
          }
        }
      } finally {
        lock.release()
      }
      const emails = rawMessages.map((msg) => buildEmailObject(msg, ''))
      emails.reverse()
      return { emails, hasMore }
    })
    return res.json({ emails, hasMore })
  } catch (err) {
    console.error('[imap] Failed to fetch emails:', err.message)
    return res.status(500).json({ message: 'Failed to fetch IMAP emails.' })
  }
})

// Shared helper: fetch list-view emails from the first available folder with pagination.
// Caller must provide an already-connected client (e.g. from withImapConnection).
async function fetchFolderEmails(client, candidateFolders, limit = 50, skip = 0) {
  for (const folderName of candidateFolders) {
    let lock
    try {
      lock = await client.getMailboxLock(folderName)
    } catch {
      continue
    }

    try {
      const messageCount = client.mailbox.exists || 0
      if (messageCount === 0) return { emails: [], hasMore: false }

      const end = Math.max(1, messageCount - skip)
      const start = Math.max(1, end - limit + 1)
      const hasMore = start > 1
      const rawMessages = []

      for await (const msg of client.fetch(`${start}:${end}`, {
        envelope: true, flags: true, uid: true,
      })) {
        rawMessages.push(msg)
      }

      const emails = rawMessages.map((msg) => buildEmailObject(msg, ''))
      emails.reverse()
      return { emails, hasMore }
    } finally {
      lock.release()
    }
  }

  return { emails: [], hasMore: false }
}

// ---------------------------------------------------------------------------
// GET /api/emails/imap/sent?skip=N
// ---------------------------------------------------------------------------
router.get('/sent', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const skip = Math.max(0, parseInt(req.query.skip) || 0)
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const { emails, hasMore } = await withImapConnection(creds, userId, (client) =>
      fetchFolderEmails(client, ['Sent', 'Sent Items', 'INBOX.Sent', '[Gmail]/Sent Mail'], SENT_PAGE_SIZE, skip)
    )
    return res.json({ emails, hasMore })
  } catch (err) {
    console.error('[imap] Failed to fetch sent emails:', err.message)
    return res.status(500).json({ message: 'Failed to fetch sent emails.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap/drafts
// ---------------------------------------------------------------------------
router.get('/drafts', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const { emails } = await withImapConnection(creds, userId, (client) =>
      fetchFolderEmails(client, ['Drafts', 'INBOX.Drafts', '[Gmail]/Drafts'], 100, 0)
    )
    return res.json({ emails })
  } catch (err) {
    console.error('[imap] Failed to fetch drafts:', err.message)
    return res.status(500).json({ message: 'Failed to fetch drafts.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/emails/imap/drafts
// ---------------------------------------------------------------------------
router.post('/drafts', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const { to, subject, body } = req.body

  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  const rawMessage = buildRawMimeMessage({
    from: creds.email,
    to: to || '',
    subject: subject || '(No Subject)',
    body: body || '',
  })

  try {
    const uid = await withImapConnection(creds, userId, async (client) => {
      for (const folder of ['Drafts', 'INBOX.Drafts', '[Gmail]/Drafts']) {
        try {
          const result = await client.append(folder, Buffer.from(rawMessage), ['\\Draft', '\\Seen'])
          return result?.uid || null
        } catch { continue }
      }
      return null
    })
    return res.json({ ok: true, uid })
  } catch (err) {
    console.error('[imap] Failed to save draft:', err.message)
    return res.status(500).json({ message: 'Failed to save draft.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap/drafts/:uid
// ---------------------------------------------------------------------------
router.get('/drafts/:uid', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.uid
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const { bodyText, bodyHtml } = await withImapConnection(creds, userId, async (client) => {
      for (const folder of ['Drafts', 'INBOX.Drafts', '[Gmail]/Drafts']) {
        let lock
        try { lock = await client.getMailboxLock(folder) } catch { continue }
        try {
          let bodyText = '', bodyHtml = ''
          for await (const msg of client.fetch(uid, { uid: true, source: true }, { uid: true })) {
            const parsed = await simpleParser(msg.source || Buffer.alloc(0), { skipHtmlToText: false })
            bodyText = (parsed.text || '').replace(/\r\n/g, '\n').trim()
            bodyHtml = parsed.html || ''
          }
          return { bodyText, bodyHtml }
        } finally {
          lock.release()
        }
      }
      return { bodyText: '', bodyHtml: '' }
    })
    return res.json({ bodyText, bodyHtml })
  } catch (err) {
    console.error('[imap] Failed to fetch draft detail:', err.message)
    return res.status(500).json({ message: 'Failed to fetch draft body.' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/emails/imap/drafts/:uid
// ---------------------------------------------------------------------------
router.delete('/drafts/:uid', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.uid
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const deleted = await withImapConnection(creds, userId, async (client) => {
      for (const folder of ['Drafts', 'INBOX.Drafts', '[Gmail]/Drafts']) {
        let lock
        try { lock = await client.getMailboxLock(folder) } catch { continue }
        try {
          await client.messageDelete(uid, { uid: true })
          return true
        } catch {
          // not in this folder, try next
        } finally {
          lock.release()
        }
      }
      return false
    })
    if (!deleted) return res.status(404).json({ message: 'Draft not found.' })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[imap] Failed to delete draft:', err.message)
    return res.status(500).json({ message: 'Failed to delete draft.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap/sent/:uid  — full body + attachment metadata
// ---------------------------------------------------------------------------
router.get('/sent/:uid', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.uid
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const result = await withImapConnection(creds, userId, async (client) => {
      for (const folder of ['Sent', 'Sent Items', 'INBOX.Sent', '[Gmail]/Sent Mail']) {
        let lock
        try { lock = await client.getMailboxLock(folder) } catch { continue }
        try {
          let bodyText = '', bodyHtml = '', attachments = []
          for await (const msg of client.fetch(uid, { uid: true, source: true }, { uid: true })) {
            const parsed = await simpleParser(msg.source || Buffer.alloc(0), { skipHtmlToText: false })
            bodyText = (parsed.text || '').replace(/\r\n/g, '\n').trim()
            bodyHtml = parsed.html || ''
            attachments = (parsed.attachments || []).map((att, index) => ({
              filename: att.filename || `attachment-${index + 1}`,
              size: att.size || 0,
              contentType: att.contentType || 'application/octet-stream',
              attachmentId: String(index),
            }))
          }
          return { bodyText, bodyHtml, attachments }
        } finally {
          lock.release()
        }
      }
      return { bodyText: '', bodyHtml: '', attachments: [] }
    })
    return res.json(result)
  } catch (err) {
    console.error('[imap] Failed to fetch sent email detail:', err.message)
    return res.status(500).json({ message: 'Failed to fetch sent email body.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap/sent/:uid/attachments/:index
// ---------------------------------------------------------------------------
router.get('/sent/:uid/attachments/:index', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.uid
  const attIndex = parseInt(req.params.index)
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const attachment = await withImapConnection(creds, userId, async (client) => {
      for (const folder of ['Sent', 'Sent Items', 'INBOX.Sent', '[Gmail]/Sent Mail']) {
        let lock
        try { lock = await client.getMailboxLock(folder) } catch { continue }
        try {
          for await (const msg of client.fetch(uid, { uid: true, source: true }, { uid: true })) {
            const parsed = await simpleParser(msg.source || Buffer.alloc(0))
            const atts = parsed.attachments || []
            if (atts[attIndex]) return atts[attIndex]
          }
        } finally {
          lock.release()
        }
      }
      return null
    })

    if (!attachment) return res.status(404).json({ message: 'Attachment not found.' })

    const filename = attachment.filename || `attachment-${attIndex + 1}`
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream')
    return res.send(attachment.content)
  } catch (err) {
    console.error('[imap] Failed to download sent attachment:', err.message)
    return res.status(500).json({ message: 'Failed to download attachment.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap/:id  — inbox email full body + attachment metadata
// Bug 3 fix: uses the connection pool — no new TCP handshake for warm users.
// ---------------------------------------------------------------------------
router.get('/:id', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.id
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const { bodyText, bodyHtml, attachments } = await withImapConnection(creds, userId, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      let bodyText = '', bodyHtml = '', attachments = []
      try {
        for await (const msg of client.fetch(uid, { uid: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source || Buffer.alloc(0), { skipHtmlToText: false })
          bodyText = (parsed.text || '').replace(/\r\n/g, '\n').trim()
          bodyHtml = parsed.html || ''
          attachments = (parsed.attachments || []).map((att, index) => ({
            attachmentId: String(index),
            filename: att.filename || `attachment-${index + 1}`,
            mimeType: att.contentType || 'application/octet-stream',
            size: att.size || 0,
          }))
        }
      } finally {
        lock.release()
      }
      return { bodyText, bodyHtml, attachments }
    })
    return res.json({ bodyText, bodyHtml, attachments })
  } catch (err) {
    console.error('[imap] Failed to fetch email detail:', err.message)
    return res.status(500).json({ message: 'Failed to fetch email body.' })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/emails/imap/:id/read
// Bug 2 fix: immediately sets or clears the \Seen flag on the IMAP server
// so Outlook (and any other client) reflects the read state without waiting
// for the server to detect inactivity.
// ---------------------------------------------------------------------------
router.patch('/:id/read', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.id
  const read = Boolean(req.body?.read)
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    await withImapConnection(creds, userId, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        if (read) {
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        } else {
          await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true })
        }
      } finally {
        lock.release()
      }
    })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[imap] Failed to update read flag:', err.message)
    return res.status(500).json({ message: 'Failed to update read status.' })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/emails/imap/:id/pin
// Sets or clears the \Flagged flag on the real IMAP server so the pinned state
// is immediately visible in Outlook and other clients.
// ---------------------------------------------------------------------------
router.patch('/:id/pin', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.id
  const pinned = Boolean(req.body?.pinned)
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    await withImapConnection(creds, userId, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        if (pinned) {
          await client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true })
        } else {
          await client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true })
        }
      } finally {
        lock.release()
      }
    })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[imap] Failed to update pin flag:', err.message)
    return res.status(500).json({ message: 'Failed to update pin status.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/emails/imap/:id/attachments/:index
// ---------------------------------------------------------------------------
router.get('/:id/attachments/:index', authMiddleware, async (req, res) => {
  const userId = req.user.userId
  const uid = req.params.id
  const attIndex = parseInt(req.params.index)
  const creds = await getImapCredentials(userId)
  if (!creds) return res.status(401).json({ message: 'IMAP account not connected.' })

  try {
    const attachment = await withImapConnection(creds, userId, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        for await (const msg of client.fetch(uid, { uid: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source || Buffer.alloc(0))
          const atts = parsed.attachments || []
          if (atts[attIndex]) return atts[attIndex]
        }
      } finally {
        lock.release()
      }
      return null
    })

    if (!attachment) return res.status(404).json({ message: 'Attachment not found.' })

    const filename = attachment.filename || `attachment-${attIndex + 1}`
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream')
    return res.send(attachment.content)
  } catch (err) {
    console.error('[imap] Failed to download inbox attachment:', err.message)
    return res.status(500).json({ message: 'Failed to download attachment.' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/emails/imap  — disconnect IMAP account
// ---------------------------------------------------------------------------
router.delete('/', authMiddleware, async (req, res) => {
  const userId = req.user.userId

  // Evict any pooled connection for this user before deleting credentials
  const creds = await getImapCredentials(userId)
  if (creds) evictFromPool(`${userId}:${creds.email}`)

  const { error } = await supabaseAdmin
    .from('connected_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'imap')

  if (error) {
    console.error('[imap] Failed to delete account:', error.message)
    return res.status(500).json({ message: 'Failed to disconnect IMAP account.' })
  }

  return res.json({ ok: true })
})

module.exports = router
