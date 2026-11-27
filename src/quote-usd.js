import { log } from './logger.js'

const QUOTE_COIN_IDS = new Map([
  ['0xba876237b0f021a6c6d852d6c26e107997cc5e81', 'hyperliquid'],
  ['0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65', 'usd-coin'],
  ['0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0', 'kinetiq'],
  ['0x11265018bf2d5a99fb71efae73ad670203c1df44', 'wrapped-nvidia-xstock'],
])

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_STALE_MS = 60 * 60 * 1000
const API_URL = 'https://api.coingecko.com/api/v3/simple/price'

let cache = null
let refreshPromise = null

async function fetchPrices() {
  const ids = [...new Set(QUOTE_COIN_IDS.values())]
  const url = new URL(API_URL)
  url.searchParams.set('ids', ids.join(','))
  url.searchParams.set('vs_currencies', 'usd')

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}`)

  const payload = await response.json()
  const prices = new Map()
  for (const [address, coinId] of QUOTE_COIN_IDS) {
    const usd = payload?.[coinId]?.usd
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      prices.set(address, usd)
    }
  }

  if (!prices.size) throw new Error('CoinGecko response contained no quote-asset USD prices')
  cache = { prices, fetchedAt: Date.now() }

  const missing = [...QUOTE_COIN_IDS.keys()].filter(address => !prices.has(address))
  if (missing.length) {
    log.warn(`CoinGecko has no USD price for ${missing.length} configured quote asset(s)`)
  }

  return prices
}

/**
 * Fetch market-price estimates for supported quote assets, using a short cache
 * and a bounded stale fallback if CoinGecko is temporarily unavailable.
 */
export async function getQuoteUsdPrices() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.prices
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      return await fetchPrices()
    } catch (e) {
      log.warn(`quote USD price refresh failed: ${e.message}`)
      if (cache && Date.now() - cache.fetchedAt < MAX_STALE_MS) {
        log.warn('using cached quote USD prices')
        return cache.prices
      }
      return new Map()
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}
