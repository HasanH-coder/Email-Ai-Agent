const express = require('express')

const router = express.Router()

const LOGO_REQUEST_TIMEOUT_MS = 4000
const DIRECT_ICON_PATHS = [
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
]
const HTML_LOGO_PATTERNS = [
  /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i,
  /<link[^>]+rel=["'][^"']*shortcut icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*shortcut icon[^"']*["'][^>]*>/i,
  /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i,
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
]

function isValidDomain(domain = '') {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain.trim())
}

async function fetchWithTimeout(url, options = {}) {
  const signal = AbortSignal.timeout(LOGO_REQUEST_TIMEOUT_MS)
  return fetch(url, {
    redirect: 'follow',
    ...options,
    signal,
  })
}

async function findDirectLogo(domain) {
  for (const path of DIRECT_ICON_PATHS) {
    const candidateUrl = `https://${domain}${path}`

    try {
      const response = await fetchWithTimeout(candidateUrl, { method: 'GET' })
      if (response.ok) {
        console.log(`[logo] direct icon success for ${domain}: ${candidateUrl}`)
        return candidateUrl
      }
    } catch {}
  }

  return null
}

async function fetchHomepage(domain) {
  for (const protocol of ['https', 'http']) {
    const homepageUrl = `${protocol}://${domain}`

    try {
      const response = await fetchWithTimeout(homepageUrl, { method: 'GET' })
      if (!response.ok) continue

      const html = await response.text()
      return {
        baseUrl: response.url || homepageUrl,
        html,
      }
    } catch {}
  }

  return null
}

function findHtmlLogoUrl(baseUrl, html = '') {
  for (const pattern of HTML_LOGO_PATTERNS) {
    const match = html.match(pattern)
    const rawUrl = match?.[1]?.trim()

    if (!rawUrl) continue

    try {
      return new URL(rawUrl, baseUrl).toString()
    } catch {}
  }

  return null
}

router.get('/logo', async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase()
  console.log(`[logo] requested domain: ${domain || '(empty)'}`)

  if (!isValidDomain(domain)) {
    console.log(`[logo] invalid domain, returning null: ${domain || '(empty)'}`)
    return res.status(400).json({ logoUrl: null })
  }

  const directLogoUrl = await findDirectLogo(domain)
  if (directLogoUrl) {
    console.log(`[logo] final logoUrl for ${domain}: ${directLogoUrl}`)
    return res.status(200).json({ logoUrl: directLogoUrl })
  }

  const homepage = await fetchHomepage(domain)
  if (!homepage) {
    console.log(`[logo] homepage fetch failed for ${domain}`)
    console.log(`[logo] final logoUrl for ${domain}: null`)
    return res.status(200).json({ logoUrl: null })
  }
  console.log(`[logo] homepage fetch succeeded for ${domain}: ${homepage.baseUrl}`)

  const htmlLogoUrl = findHtmlLogoUrl(homepage.baseUrl, homepage.html)
  if (htmlLogoUrl) {
    console.log(`[logo] html logo found for ${domain}: ${htmlLogoUrl}`)
  } else {
    console.log(`[logo] no html logo found for ${domain}`)
  }
  console.log(`[logo] final logoUrl for ${domain}: ${htmlLogoUrl || 'null'}`)
  return res.status(200).json({ logoUrl: htmlLogoUrl || null })
})

module.exports = router
