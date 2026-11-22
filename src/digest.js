import { config } from './config.js'
import { log } from './logger.js'
import { quoteInfo } from './constants.js'
import { fmtAmount, fmtPrice, pctChange } from './price.js'
import { digestMessage } from './render.js'

/**
 * Trade digest.
 *
 * Trades are far too frequent to post one embed each — a handful of active
 * pools would bury the channel. Instead every qualifying trade accumulates
 * into a per-pool bucket, and a flush timer posts one summary embed per pool.
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

async function flush() {
  if (!buckets.size || !sendFn) return

  const due = [...buckets.values()]
  buckets.clear()

  for (const b of due) {
    const total = b.buyVolume + b.sellVolume
    if (total < config.alerts.minTradeQuote) continue
    try {
      await sendFn(digestMessage(b))
      log.info(
        `digest ${b.pool.symbol ?? '?'} ${b.buys}b/${b.sells}s ${total.toFixed(4)} ` +
        `${quoteInfo(b.pool.quote).symbol}`,
      )
    } catch (e) {
      log.error(`digest send failed for ${b.pool.symbol ?? b.pool.poolId}: ${e.message}`)
    }
  }
}

export function startDigest(send) {
  sendFn = send
  if (flushTimer) return
  const ms = config.alerts.digestSeconds * 1000
  flushTimer = setInterval(() => {
    flush().catch(e => log.error(`digest flush: ${e.message}`))
  }, ms)
  flushTimer.unref?.()
  log.info(`trade digest every ${config.alerts.digestSeconds}s`)
}
