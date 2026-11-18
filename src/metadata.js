import { log } from './logger.js'
import { config } from './config.js'

const cache = new Map() // token -> { data, at }
const TTL_MS = 10 * 60 * 1000
const NEGATIVE_TTL_MS = 2 * 60 * 1000

/**
 * Ascend's metadata API. Creators publish art *after* launching, so a fresh
 * coin 404s until they do — we cache the miss briefly and retry later.
 *
 * Docs: GET https://api.ascendlaunch.xyz/v1/tokens/<address>/metadata
 * 200 current claim · 400 malformed · 404 no claim yet · 429 back off
 */
export async function fetchMetadata(token) {
  const key = token.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < (hit.data ? TTL_MS : NEGATIVE_TTL_MS)) {
    return hit.data
  }

  try {
    const res = await fetch(`https://api.ascendlaunch.xyz/v1/tokens/${key}/metadata`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (res.status === 200) {
      const data = await res.json()
      cache.set(key, { data, at: Date.now() })
      return data
    }

    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? 30)
      log.warn(`metadata 429 for ${key}, backing off ${retry}s`)
      cache.set(key, { data: null, at: Date.now() + retry * 1000 })
      return null
    }

    if (res.status === 404) {
      cache.set(key, { data: null, at: Date.now() })
      return null
    }

    log.debug(`metadata ${res.status} for ${key}`)
    cache.set(key, { data: null, at: Date.now() })
    return null
  } catch (e) {
    log.debug(`metadata fetch failed for ${key}: ${e.message}`)
    cache.set(key, { data: null, at: Date.now() })
    return null
  }
}

/** Turn an ipfs:// URI into an https URL through the configured gateway. */
export function resolveUri(uri) {
  if (!uri) return null
  if (uri.startsWith('ipfs://')) {
    return config.ipfsGateway.replace(/\/?$/, '/') + uri.slice('ipfs://'.length)
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri
  return null
}

export function clearMetadataCache() {
  cache.clear()
}
