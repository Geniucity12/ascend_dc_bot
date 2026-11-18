import { config } from './config.js'
import { log } from './logger.js'
import { ADDR } from './constants.js'
import { TOPIC } from './abi.js'
import { getHead, getLogsChunked } from './chain.js'
import { getCursor, setCursor } from './db.js'
import { processLogs } from './watcher.js'

// Walks history forward from START_BLOCK one batch at a time.

const CURSOR_KEY = 'main'
const BATCH = 50_000n
const PAUSE_MS = 1_500

let running = false

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Crawl the whole range the live watcher can't cover, in resumable batches.
 */
export async function startBackfill(send, { batch = BATCH, pauseMs = PAUSE_MS } = {}) {
  if (running) {
    log.debug('backfill already running, skipping')
    return
  }
  running = true

  try {
    let head = await getHead()
    let from = getCursor(CURSOR_KEY, config.chain.startBlock)
    const start = from

    if (from >= head) {
      log.info(`backfill: already at head (${head}); nothing to do`)
      return
    }

    log.info(`backfill: ${from} → ${head} (${head - from} blocks, ${batch}/batch)`)

    let launches = 0
    let trades = 0
    let batches = 0

    while (from < head) {
      const to = from + batch > head ? head : from + batch
      const res = { launches: 0, trades: 0 }

      try {
        const logs = await getLogsChunked({
          address: [ADDR.launchpad, ADDR.poolManager],
          fromBlock: from + 1n,
          toBlock: to,
        })

        // Launches first so swaps can resolve their pool.
        await processLogs(logs.filter(l => l.topics?.[0] === TOPIC.Launched), send, res)
        await processLogs(logs.filter(l => l.topics?.[0] === TOPIC.PoolSwap), send, res)
      } catch (e) {
        // Window permanently failed: skip it rather than stalling forever.
        log.error(`backfill ${from}-${to} failed: ${e.message}; skipping window`)
      }

      launches += res.launches
      trades += res.trades
      batches++

      // Advance the cursor only after the batch is durably processed, so a
      // crash resumes here instead of re-crawling from the deploy block.
      from = to
      setCursor(CURSOR_KEY, from)

      const pct = Number((from - start) * 1000n / (head - start)) / 10
      log.info(`backfill ${pct}% · block ${from} · launches=${launches} trades=${trades}`)

      if (from < head) await sleep(pauseMs)
      head = await getHead()
    }

    log.info(`backfill complete: ${batches} batches, ${launches} launches, ${trades} trades`)
  } catch (e) {
    log.error(`backfill crashed: ${e.message}`)
  } finally {
    running = false
  }
}

export function isBackfilling() {
  return running
}
