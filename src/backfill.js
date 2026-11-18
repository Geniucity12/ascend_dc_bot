import { config } from './config.js'
import { log } from './logger.js'
import { ADDR } from './constants.js'
import { TOPIC } from './abi.js'
import { getHead, getLogsChunked } from './chain.js'
import { getCursor, setCursor } from './db.js'
import { processLogs } from './watcher.js'

// Deep-history crawler.
//
// Reconcile() keeps the shallow recent window healthy so live alerts recover
// quickly after a disconnect. This walks the full range from START_BLOCK in
// resumable batches, because that is far too slow (and too rate-limit-hostile)
// to do inline at startup.
//
// It uses its OWN cursor. Reconcile's `main` cursor tracks the live window and
// jumps to head after every run; sharing it would make this crawler believe
// the whole history was already indexed and exit immediately.

const CURSOR_KEY = 'backfill'

// Batches are deliberately small. A batch contains every launch in its block
// range, and each launch costs three RPC calls (token, slot0, metadata) that
// are processed one at a time. A 50k window can hold 90+ launches, i.e. ~270
// serial calls before the cursor moves once, which makes the crawl look hung.
const BATCH = 10_000n
const PAUSE_MS = 750

let running = false

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Crawl from the backfill cursor (or START_BLOCK) to head in batches.
 *
 * Resumable: the cursor is persisted after every batch, so a restart picks up
 * where it stopped instead of re-crawling from the deploy block.
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

    const total = head - cursor
    log.info(`backfill: ${from} → ${head} (${total} blocks, ${batch}/batch)`)

    let launches = 0
    let trades = 0
    let batches = 0

    while (from < head) {
      const to = from + batch > head ? head : from + batch
      const res = { launches: 0, trades: 0 }
      const startedAt = Date.now()

      try {
        const logs = await getLogsChunked({
          address: [ADDR.launchpad, ADDR.poolManager],
          fromBlock: from + 1n,
          toBlock: to,
        })

        const launchLogs = logs.filter(l => l.topics?.[0] === TOPIC.Launched)
        const swapLogs = logs.filter(l => l.topics?.[0] === TOPIC.PoolSwap)

        // Announce the batch before processing it. A launch-dense window takes
        // minutes to enrich, and without this it is indistinguishable from a
        // hung process.
        log.info(
          `backfill batch ${from}-${to}: ${logs.length} logs ` +
          `(${launchLogs.length} launches, ${swapLogs.length} swaps)`,
        )

        // Launches first so swaps can resolve their pool.
        // silent=true: index history without posting it to Discord.
        await processLogs(launchLogs, send, res, true)
        await processLogs(swapLogs, send, res, true)
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

      const pct = Number((from - cursor) * 1000n / (total || 1n)) / 10
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      log.info(
        `backfill ${pct}% · block ${from} · launches=${launches} trades=${trades} · ${secs}s`,
      )

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
