import { config } from './config.js'
import { log } from './logger.js'
import { ADDR, quoteInfo } from './constants.js'
import { TOPIC } from './abi.js'
import {
  getHead, getLogsChunked, decodeLog, readToken, readSlot0, tokenIsCurrency0,
} from './chain.js'
import {
  getCursor, setCursor, insertPool, getPool, recordTrade, markSeen,
} from './db.js'
import { fetchMetadata } from './metadata.js'
import { sqrtPriceToPrice, parseSwap } from './price.js'
import { launchEmbed } from './render.js'
import { enqueueTrade } from './digest.js'

const CURSOR_KEY = 'main'

// Rate limiting: a busy pool can trade many times a second. We cap total
// alerts per minute and enforce a per-pool cooldown so the channel stays
// readable instead of turning into a firehose.
const recentAlerts = []
const lastAlertByPool = new Map()
let reconciling = false

function underRateLimit() {
  const now = Date.now()
  while (recentAlerts.length && now - recentAlerts[0] > 60_000) recentAlerts.shift()
  return recentAlerts.length < config.alerts.maxAlertsPerMinute
}

function poolCooledDown(poolId) {
  const last = lastAlertByPool.get(poolId) ?? 0
  return Date.now() - last >= config.alerts.poolCooldownSeconds * 1000
}

function noteAlert(poolId) {
  recentAlerts.push(Date.now())
  lastAlertByPool.set(poolId, Date.now())
}

/**
 * Handle a Launched event: read the token, resolve metadata, store the pool,
 * and post the launch embed.
 */
async function handleLaunch(rawLog, send, res) {
  const decoded = decodeLog(rawLog)
  if (!decoded || decoded.eventName !== 'Launched') return
  const { poolId, token, creator, quote, devBuyTokens, fee, builderFee } = decoded.args

  if (!markSeen(`L:${rawLog.transactionHash}:${rawLog.logIndex}`)) return
  if (getPool(poolId)) return
  if (res) res.launches++

  const [tok, slot0, metadata] = await Promise.all([
    readToken(token),
    readSlot0(poolId).catch(() => null),
    fetchMetadata(token),
  ])

  const tokenIs0 = tokenIsCurrency0(token, quote)
  const q = quoteInfo(quote)
  const firstPrice = slot0
    ? sqrtPriceToPrice(slot0.sqrtPriceX96, tokenIs0, tok.decimals, q.decimals)
    : 0

  const pool = {
    poolId,
    token,
    creator,
    quote,
    tokenIs0,
    tokenDecimals: tok.decimals,
    name: metadata?.name ?? tok.name ?? null,
    symbol: metadata?.symbol ?? tok.symbol ?? null,
    imageUri: metadata?.imageUri ?? null,
    feePips: Number(fee),
    builderFee: Number(builderFee),
    devBuy: devBuyTokens.toString(),
    launchedAt: Math.floor(Date.now() / 1000),
    launchBlock: Number(rawLog.blockNumber),
    firstPrice,
  }

  insertPool(pool)
  log.info(`launch ${pool.symbol ?? token} pool=${poolId.slice(0, 10)} price=${firstPrice}`)

  if (!config.alerts.launches) return
  if (!underRateLimit()) {
    log.warn('launch alert dropped: rate limit')
    return
  }

  noteAlert(poolId)
  await send({
    embeds: [launchEmbed({ pool, metadata, txHash: rawLog.transactionHash })],
  poolToken: token,
  })
}

/**
 * Handle a PoolManager Swap event. Only pools Ascend launched are alerted on;
 * the PoolManager carries every v4 pool on the chain.
 */
async function handleSwap(rawLog, send, res) {
  const decoded = decodeLog(rawLog)
  if (!decoded || decoded.eventName !== 'Swap') return

  const poolId = decoded.args.id
  const pool = getPool(poolId)
  if (!pool) return // not an Ascend launch pool

  if (!markSeen(`S:${rawLog.transactionHash}:${rawLog.logIndex}`)) return
  if (res) res.trades++

  const q = quoteInfo(pool.quote)
  const trade = parseSwap(decoded.args, pool.tokenIs0, pool.tokenDecimals, q.decimals, pool.quote)
  const updated = recordTrade(poolId, { price: trade.price, volumeQuote: trade.quoteAmount })

  log.debug(
    `trade ${pool.symbol ?? '?'} ${trade.isBuy ? 'BUY' : 'SELL'} ` +
    `${trade.quoteAmount.toFixed(4)} ${q.symbol} @ ${trade.price.toExponential(4)}`,
  )

  if (!config.alerts.trades) return

  const minTrade = config.alerts.minTradeQuote
    ? Number(config.alerts.minTradeQuote)
    : q.minTrade
  if (trade.quoteAmount < minTrade) {
    log.debug(`  skipped: ${trade.quoteAmount.toFixed(4)} < min ${minTrade} ${q.symbol}`)
    return
  }
// Individual trade embeds are off by default: one embed per trade cannot
// scale past a handful of pools. Trades accumulate into a per-pool digest
// instead, flushed by startDigest() in index.js.
const queued = enqueueTrade(updated ?? pool, trade)
if (!queued.ok) log.debug(` digest skipped: ${queued.reason}`)
}

export async function processLogs(logs, send, res = { launches: 0, trades: 0 }) {
  for (const rawLog of logs) {
    const topic0 = rawLog.topics?.[0]
    try {
      if (topic0 === TOPIC.Launched) {
        const before = res.launches
        await handleLaunch(rawLog, send, res)
        if (res.launches > before) continue
      } else if (topic0 === TOPIC.PoolSwap) {
        await handleSwap(rawLog, send, res)
      }
    } catch (e) {
      log.error(`failed handling ${topic0?.slice(0, 10)}: ${e.message}`)
    }
  }
}

/**
 * Reconcile from the stored cursor to head.
 *
 * This is the ONLY function that advances the cursor, because it is the only
 * one that walks a contiguous block range. It is safe to call at any time:
 * markSeen() deduplicates anything the live socket already delivered.
 *
 * Runs on start, on every (re)connect, and on a timer — so a laptop sleeping
 * for hours cannot silently swallow launches, which is exactly what happened
 * before this existed.
 */
export async function reconcile(send, {
  maxBlocksPerRun = 100_000n,
  coldStartBlocks = 2_000n,
} = {}) {
  if (reconciling) {
    log.debug('reconcile already running, skipping')
    return
  }
  reconciling = true

  try {
    const head = await getHead()
    let from = getCursor(CURSOR_KEY, null)
    let reason = 'resume'

    if (from === null) {
 // Empty DB: cover only a shallow recent window here so the bot starts
 // alerting quickly. startBackfill() walks the full range from START_BLOCK
 // in the background; crawling millions of blocks inline would block
 // Discord login and get the public RPC to rate-limit us.
 from = head > coldStartBlocks ? head - coldStartBlocks : 0n
      reason = 'cold start'
    }

    if (from > head) {
      from = head
    }

 // Walk FORWARD from the cursor. Never jump to head: jumping skips every
 // block in between and then setCursor() below marks that history as
 // indexed. The backfill owns deep history; reconcile advances one batch.
 const behind = head - from
 let to = head
 if (behind > maxBlocksPerRun) {
 to = from + maxBlocksPerRun
 log.info(`cursor ${behind} blocks behind; this run covers ${maxBlocksPerRun}`)
 reason = 'capped'
 }

 const span = to - from
    log.info(`reconcile (${reason}) ${from} → ${to} (${span} block${span === 1n ? '' : 's'})`)

    if (span > 0n) {
      const logs = await getLogsChunked({
        address: [ADDR.launchpad, ADDR.poolManager],
        fromBlock: from + 1n,
        toBlock: to,
      })
      log.info(`reconcile fetched ${logs.length} logs`)

      // Launches first, so swaps can resolve their pool.
      const launches = logs.filter(l => l.topics?.[0] === TOPIC.Launched)
      const swaps = logs.filter(l => l.topics?.[0] === TOPIC.PoolSwap)
      const res = { launches: 0, trades: 0 }

      await processLogs(launches, send, res)
      await processLogs(swaps, send, res)

      if (res.launches || res.trades) {
        log.info(`reconcile processed launches=${res.launches} trades=${res.trades}`)
      }
    }

    setCursor(CURSOR_KEY, to)
  } catch (e) {
    log.error(`reconcile failed: ${e.message}`)
  } finally {
    reconciling = false
  }
}

// Backwards-compatible alias.
export const backfill = reconcile

/**
 * Live subscription. On any socket close we reconnect, and every (re)connect
 * runs a backfill to pick up whatever was missed.
 */
export function startLive(send) {
  let reconnectTimer = null

  const connect = () => {
    log.info('opening live log subscription…')
    const socket = new WebSocket(config.chain.wsUrl)

    socket.onopen = () => {
      log.info('websocket open')
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_subscribe',
        params: ['logs', { address: [ADDR.launchpad, ADDR.poolManager] }],
      }))
    }

    socket.onmessage = async (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }

      if (msg.id === 1) {
        if (msg.error) {
          log.error(`subscribe failed: ${msg.error.message}`)
          socket.close()
          return
        }
        log.info(`subscribed: ${msg.result}`)
        backfill(send).catch(e => log.error(`post-subscribe backfill: ${e.message}`))
        return
      }

      if (msg.method === 'eth_subscription' && msg.params?.result) {
        const rawLog = msg.params.result
        const topic0 = rawLog.topics?.[0]
        try {
          if (topic0 === TOPIC.Launched) await handleLaunch(rawLog, send)
          else if (topic0 === TOPIC.PoolSwap) await handleSwap(rawLog, send)
          // NOTE: deliberately does NOT advance the cursor. Live events are
          // sparse and can be missed while the socket is down, so they are
          // not a contiguous history. Only reconcile() advances the cursor,
          // and markSeen() makes the resulting double-delivery harmless.
        } catch (e) {
          log.error(`live event failed: ${e.message}`)
        }
      }
    }

    socket.onerror = () => log.warn('websocket error')

    socket.onclose = () => {
      log.warn('websocket closed; reconnecting in 5s')
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connect, 5000)
    }
  }

  connect()
}

