import { config } from './config.js'
import { log } from './logger.js'
import { quoteInfo } from './constants.js'
import { fmtAmount, fmtPrice, pctChange } from './price.js'
import { digestMessage, leaderboardMessage } from './render.js'
import { watchersOf } from './db.js'
import { getQuoteUsdPrices } from './quote-usd.js'

/**
 * Trade digest.
 *
 * Trades are far too frequent to post one embed each — a handful of active
 * pools would bury the channel. Trades accumulate into per-pool buckets, then
 * each flush posts one combined leaderboard. Watched pools additionally get
 * their own summary so their watchers retain coin-specific pings.
 *
 * Buckets only exist for pools that pass the activity gate, so a brand-new
 * pool with two trades never produces a digest. Launches still post instantly.
 */

// poolId -> bucket
const buckets = new Map()
let flushTimer = null
let sendFn = null

/**
 * A pool must clear the gate before its trades are worth a digest. The gate is
 * "either real volume or a real number of prints", so a pool that just happened
 * to see one large buy early does not start spamming.
 */
export function poolIsActive(pool) {
  const trades = pool.tradeCount ?? 0
  const volume = pool.volumeQuote ?? 0
  const q = quoteInfo(pool.quote)
  return trades >= config.alerts.digestMinTrades || volume >= config.alerts.digestMinVolume
}

/**
 * Record a trade for later flushing. Returns false when it was dropped, so the
 * caller can log why instead of silently doing nothing.
 */
export function enqueueTrade(pool, trade) {
  if (!poolIsActive(pool)) return { ok: false, reason: 'pool below activity gate' }

  const key = pool.poolId
  let b = buckets.get(key)
  if (!b) {
    b = {
      pool,
      buys: 0,
      sells: 0,
      buyVolume: 0,
      sellVolume: 0,
      largest: trade,
      last: trade,
      firstAt: Date.now(),
    }
    buckets.set(key, b)
  }

  if (trade.isBuy) {
    b.buys++
    b.buyVolume += trade.quoteAmount
  } else {
    b.sells++
    b.sellVolume += trade.quoteAmount
  }
  if (trade.quoteAmount > b.largest.quoteAmount) b.largest = trade
  b.last = trade
  b.pool = pool

  return { ok: true }
}

export function pendingDigestCount() {
  return buckets.size
}

export async function flushDigest() {
  if (!buckets.size || !sendFn) return

  const due = [...buckets.values()]
  buckets.clear()

  const qualified = due.filter(b =>
    b.buyVolume + b.sellVolume >= config.alerts.minTradeQuote,
  )
  if (!qualified.length) return

  const quoteUsdPrices = await getQuoteUsdPrices()
  const priced = qualified.flatMap(b => {
    const usdRate = quoteUsdPrices.get(b.pool.quote.toLowerCase())
    if (!usdRate) return []
    return [{
      ...b,
      usdVolume: (b.buyVolume + b.sellVolume) * usdRate,
    }]
  })
  const omittedCount = qualified.length - priced.length

  const ranked = priced
    .sort((a, b) => {
      const volumeDiff = b.usdVolume - a.usdVolume
      return volumeDiff || String(a.pool.symbol ?? '').localeCompare(String(b.pool.symbol ?? ''))
    })
    .slice(0, 10)

  if (ranked.length) {
    try {
      await sendFn(leaderboardMessage(ranked, config.alerts.digestSeconds, omittedCount))
      log.info(`USD leaderboard posted ${ranked.length} pool(s); omitted=${omittedCount}`)
    } catch (e) {
      log.error(`leaderboard send failed: ${e.message}`)
    }
  } else {
    log.warn('leaderboard skipped: no qualified pools have a USD quote price')
  }

  for (const b of qualified) {
    const guildIds = [...new Set(watchersOf(b.pool.token).map(w => w.guild_id))]
    if (!guildIds.length) continue
    try {
      await sendFn({ ...digestMessage(b), targetGuildIds: guildIds })
      log.info(
        `watch digest ${b.pool.symbol ?? '?'} ${b.buys}b/${b.sells}s ` +
        `${(b.buyVolume + b.sellVolume).toFixed(4)} ` +
        `${quoteInfo(b.pool.quote).symbol}`,
      )
    } catch (e) {
      log.error(`watch digest send failed for ${b.pool.symbol ?? b.pool.poolId}: ${e.message}`)
    }
  }
}

export function startDigest(send) {
  sendFn = send
  if (flushTimer) return
  const ms = config.alerts.digestSeconds * 1000
  flushTimer = setInterval(() => {
    flushDigest().catch(e => log.error(`digest flush: ${e.message}`))
  }, ms)
  flushTimer.unref?.()
  log.info(`trade digest every ${config.alerts.digestSeconds}s`)
}
