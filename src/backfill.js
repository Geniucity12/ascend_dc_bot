import { config } from './config.js'
import { log } from './logger.js'
import { ADDR } from './constants.js'
import { TOPIC } from './abi.js'
import { getHead, getLogsChunked } from './chain.js'
import { getCursor, setCursor } from './db.js'
import { processLogs } from './watcher.js'

// Deep-history crawler.
//
// Crawls BACKWARD from head toward START_BLOCK, not forward. Direction matters
// for the user experience, not just the workload: crawling forward fills the
// database with the oldest launches first, so /recent (which sorts by block)
// shows two-week-old coins next to today's for the entire duration of the
// crawl. Walking back from head makes the newest history available within the
// first batch and grows the tail over time.
//
// Reconcile() keeps the shallow recent window healthy so live alerts recover
// after a disconnect. This crawler uses its OWN cursor for the same window,
// because reconcile jumps that window to head after every run.

// Distinct key from the forward crawler's. That one wrote a high-water mark
// (~deploy block + a few batches); read as a low-water mark it would claim the
// entire history above it was already indexed and skip everything.
const CURSOR_KEY = 'backfill_desc'

// Small batches: a window holds every launch in its range and each launch
// costs three RPC calls (token, slot0, metadata) processed one at a time.
const BATCH = 10_000n
const PAUSE_MS = 750

let running = false

const sleep = ms => new Promise(r => setTimeout(r, ms))

const max = (a, b) => (a > b ? a : b)

/**
 * Crawl from head down to START_BLOCK in batches.
 *
 * Resumable from the low-water mark: the cursor records how far back we have
 * got, so a restart continues from there rather than re-crawling the head.
 */
export async function startBackfill(send, { batch = BATCH, pauseMs = PAUSE_MS } = {}) {
  running = true

  try {
    const head = await getHead()
    const floor = config.chain.startBlock

    // The cursor is the low-water mark: everything above it is already
    // indexed. Absent, we start at the top and work down.
    const cursor = getCursor(CURSOR_KEY, head)
    let to = cursor > head ? head : cursor

    if (to <= floor) {
      log.info(`backfill: history complete (low-water ${to} <= ${floor}); nothing to do`)
      return
    }

    const total = to - floor
    log.info(`backfill: ${to} → ${floor} (${total} blocks, ${batch}/batch, descending)`)

    let launches = 0
    let trades = 0
    let batches = 0

    while (to > floor) {
      const from = to - batch < floor ? floor : to - batch
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

        // Announce the batch before processing it: a launch-dense window takes
        // minutes to enrich and otherwise looks like a hung process.
        log.info(
          `backfill batch ${from}-${to}: ${logs.length} logs ` +
          `(${launchLogs.length} launches, ${swapLogs.length} swaps)`,
        )

        // Launches first so swaps can resolve their pool.
        // silent=true: index history without posting it to Discord.
        await processLogs(launchLogs, send, res, true)
        await processLogs(swapLogs, send, res, true)
      } catch (e) {
        log.error(`backfill ${from}-${to} failed: ${e.message}; skipping window`)
      }

      launches += res.launches
      trades += res.trades
      batches++

      // Persist the low-water mark only after the batch is durably processed,
      // so a restart resumes here instead of re-crawling from the head.
      to = from
      setCursor(CURSOR_KEY, to)

      const pct = Number((total - (to - floor)) * 1000n / (total || 1n)) / 10
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      log.info(
        `backfill ${pct}% · back to block ${to} · launches=${launches} trades=${trades} · ${secs}s`,
      )

      if (to > floor) await sleep(pauseMs)
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
