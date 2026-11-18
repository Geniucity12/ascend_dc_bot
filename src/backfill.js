import { config } from './config.js'
import { log } from './logger.js'
import { ADDR } from './constants.js'
import { TOPIC } from './abi.js'
import { getHead, getLogsChunked } from './chain.js'
import { getCursor, setCursor } from './db.js'
import { processLogs } from './watcher.js'

// Deep-history crawler. Reconcile() handles the shallow recent window so live
// alerts recover quickly after a disconnect; this walks the full range from
// START_BLOCK in resumable batches, because that is far too slow (and too
// rate-limit-hostile) to do inline at startup.
//
// Uses its OWN cursor. Reconcile's `main` cursor tracks the live window and
// jumps to head after every run, so sharing it would make this crawler think
// the whole history was already indexed and exit immediately.

const CURSOR_KEY = 'backfill'
const BATCH = 50_000n
const PAUSE_MS = 1_500

let running = false

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Crawl from the backfill cursor (or START_BLOCK) to head in batches.
 *
 * Resumable: the cursor is persisted after every batch, so a restart picks up
 * where it stopped instead of re-crawling from the deploy block. Deliberately
 * independent of reconcile's cursor — see CURSOR_KEY above.
 */
export async function startBackfill(send, { batch = BATCH, pauseMs = PAUSE_MS } = {}) {
  running = true

  try {
    let head = await getHead()
    const floor = config.chain.startBlock
    const cursor = getCursor(CURSOR_KEY, floor)
    let from = cursor < floor ? floor : cursor

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
        // A permanently failed window is skipped rather than stalling forever.
        log.error(`backfill ${from}-${to} failed: ${e.message}; skipping window`)
      }

      launches += res.launches
      trades += res.trades
      batches++

      // Advance only after the batch is durably processed, so a restart
      // resumes here instead of re-crawling from the deploy block.
      from = to
      setCursor(CURSOR_KEY, from)

      const total = head - cursor || 1n
      const pct = Number((from - cursor) * 1000n / total) / 10
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
