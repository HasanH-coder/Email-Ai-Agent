const supabaseAdmin = require('../config/supabase')

const GUARDED_TOKEN_PROVIDERS = new Set(['gmail', 'outlook'])

function isGuardedProvider(provider) {
  return GUARDED_TOKEN_PROVIDERS.has(provider)
}

function summarizeTokenState(token) {
  return token == null ? 'null' : 'present'
}

function normalizeTokenExpiresAt(tokenExpiresAt) {
  if (!tokenExpiresAt) return null
  const parsedDate = tokenExpiresAt instanceof Date ? tokenExpiresAt : new Date(tokenExpiresAt)
  if (Number.isNaN(parsedDate.getTime())) return null
  return parsedDate.toISOString()
}

function scoreConnectedAccountRow(row) {
  let score = 0
  if (row?.provider_access_token) score += 2
  if (row?.provider_refresh_token) score += 1
  if (row?.email) score += 1
  return score
}

function pickPreferredConnectedAccountRow(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  return [...rows].sort((left, right) => scoreConnectedAccountRow(right) - scoreConnectedAccountRow(left))[0] || null
}

function applyEmailFilter(query, email) {
  if (email == null) {
    return query.is('email', null)
  }
  return query.eq('email', email)
}

function logConnectedAccountTokenWrite({
  codePath,
  userId,
  provider,
  email,
  existingRow,
  nextAccessToken,
  nextRefreshToken,
  accessTokenChanged,
  refreshTokenChanged,
}) {
  console.info('[connected_accounts] token write', {
    codePath,
    user_id: userId,
    provider,
    email: email || null,
    access_token_changed: accessTokenChanged,
    refresh_token_changed: refreshTokenChanged,
    existing_access_token: summarizeTokenState(existingRow?.provider_access_token),
    existing_refresh_token: summarizeTokenState(existingRow?.provider_refresh_token),
    next_access_token: summarizeTokenState(nextAccessToken),
    next_refresh_token: summarizeTokenState(nextRefreshToken),
  })
}

async function listConnectedAccounts({ userId, provider, email }) {
  let query = supabaseAdmin
    .from('connected_accounts')
    .select('user_id, provider, email, provider_access_token, provider_refresh_token, provider_token_expires_at')
    .eq('user_id', userId)
    .eq('provider', provider)

  if (email !== undefined) {
    query = applyEmailFilter(query, email)
  }

  const { data, error } = await query
  if (error) {
    throw error
  }

  return Array.isArray(data) ? data : []
}

async function getPreferredConnectedAccount({ userId, provider, email, requireAccessToken = false }) {
  const rows = await listConnectedAccounts({ userId, provider, email })
  const filteredRows = requireAccessToken
    ? rows.filter((row) => Boolean(row?.provider_access_token))
    : rows
  return pickPreferredConnectedAccountRow(filteredRows)
}

async function upsertConnectedAccountTokens({
  codePath,
  userId,
  provider,
  email,
  accessToken,
  refreshToken,
  tokenExpiresAt,
}) {
  if (!userId || !provider || email == null) {
    throw new Error('Missing connected account identity for upsert.')
  }
  if (!accessToken) {
    throw new Error(`Refusing to upsert ${provider} account without an access token.`)
  }

  const existingRow = await getPreferredConnectedAccount({ userId, provider, email })
  const nextRefreshToken = refreshToken ?? existingRow?.provider_refresh_token ?? undefined
  const nextAccessToken = accessToken
  const nextTokenExpiresAt =
    tokenExpiresAt !== undefined
      ? normalizeTokenExpiresAt(tokenExpiresAt)
      : (existingRow?.provider_token_expires_at || undefined)

  logConnectedAccountTokenWrite({
    codePath,
    userId,
    provider,
    email,
    existingRow,
    nextAccessToken,
    nextRefreshToken,
    nextTokenExpiresAt,
    accessTokenChanged: existingRow?.provider_access_token !== nextAccessToken,
    refreshTokenChanged:
      nextRefreshToken !== undefined && existingRow?.provider_refresh_token !== nextRefreshToken,
  })

  const payload = {
    user_id: userId,
    provider,
    email,
    provider_access_token: nextAccessToken,
  }

  if (nextRefreshToken !== undefined) {
    payload.provider_refresh_token = nextRefreshToken
  }
  if (nextTokenExpiresAt !== undefined) {
    payload.provider_token_expires_at = nextTokenExpiresAt
  }

  const { error } = await supabaseAdmin
    .from('connected_accounts')
    .upsert([payload], { onConflict: 'user_id,provider,email' })

  if (error) {
    throw error
  }
}

async function updateConnectedAccountTokens({
  codePath,
  userId,
  provider,
  email,
  accessToken,
  refreshToken,
  tokenExpiresAt,
  allowTokenClear = false,
}) {
  const existingRow = await getPreferredConnectedAccount({
    userId,
    provider,
    email,
    requireAccessToken: false,
  })

  if (!existingRow) {
    return null
  }

  const updatePayload = {}
  let nextAccessToken = existingRow.provider_access_token
  let nextRefreshToken = existingRow.provider_refresh_token
  let nextTokenExpiresAt = existingRow.provider_token_expires_at || null

  if (accessToken !== undefined) {
    if (accessToken == null) {
      if (isGuardedProvider(provider) && existingRow.provider_access_token && !allowTokenClear) {
        throw new Error(`Refusing to clear ${provider} access token outside explicit disconnect.`)
      }
      nextAccessToken = null
      updatePayload.provider_access_token = null
    } else {
      nextAccessToken = accessToken
      updatePayload.provider_access_token = accessToken
    }
  }

  if (refreshToken !== undefined) {
    if (refreshToken == null) {
      if (isGuardedProvider(provider) && existingRow.provider_refresh_token && !allowTokenClear) {
        throw new Error(`Refusing to clear ${provider} refresh token outside explicit disconnect.`)
      }
      nextRefreshToken = null
      updatePayload.provider_refresh_token = null
    } else {
      nextRefreshToken = refreshToken
      updatePayload.provider_refresh_token = refreshToken
    }
  }

  if (tokenExpiresAt !== undefined) {
    nextTokenExpiresAt = normalizeTokenExpiresAt(tokenExpiresAt)
    updatePayload.provider_token_expires_at = nextTokenExpiresAt
  }

  const accessTokenChanged =
    Object.prototype.hasOwnProperty.call(updatePayload, 'provider_access_token') &&
    existingRow.provider_access_token !== nextAccessToken
  const refreshTokenChanged =
    Object.prototype.hasOwnProperty.call(updatePayload, 'provider_refresh_token') &&
    existingRow.provider_refresh_token !== nextRefreshToken

  logConnectedAccountTokenWrite({
    codePath,
    userId,
    provider,
    email: existingRow.email,
    existingRow,
    nextAccessToken,
    nextRefreshToken,
    nextTokenExpiresAt,
    accessTokenChanged,
    refreshTokenChanged,
  })

  if (!Object.keys(updatePayload).length) {
    return existingRow
  }

  let query = supabaseAdmin
    .from('connected_accounts')
    .update(updatePayload)
    .eq('user_id', userId)
    .eq('provider', provider)

  query = applyEmailFilter(query, existingRow.email)

  const { error } = await query
  if (error) {
    throw error
  }

  return {
    ...existingRow,
    ...updatePayload,
  }
}

module.exports = {
  getPreferredConnectedAccount,
  upsertConnectedAccountTokens,
  updateConnectedAccountTokens,
}
