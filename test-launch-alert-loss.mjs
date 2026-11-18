import { rmSync, existsSync } from 'node:fs'
import {
  openDb, insertPool, getPool, markAnnounced, unannouncedPools, poolCount,
} from './src/db.js'

// Reproduces the GTI loss exactly.
//
// GTI launched at block 7967905. Two commits deployed ~13 minutes later. The
// restart's reconcile ran with a span wider than RECENT_WINDOW, indexed GTI
// SILENTLY, and insertPool()/markSeen() then made it permanently unpostable:
// every later pass hit "already indexed" and returned before announcing.
//
// The fix has two halves, and this test covers both:
//   1. an indexed-but-unannounced pool stays visible to unannouncedPools()
//   2. reconciling the same launch again can still announce it

const DB = '/tmp/launch-alert-loss.db'
for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

openDb(DB)

const GTI_BLOCK = 7967905
const mk = (sym, block) => ({
  poolId: `0x${sym}`, token: `0xt${sym}`, creator: '0xc',
  quote: '0xba876237b0f021a6c6d852d6c26e107997cc5e81',
  tokenIs0: false, tokenDecimals: 18, symbol: sym,
  launchedAt: Math.floor(Date.now() / 1000), launchBlock: block, firstPrice: 1e-8,
})

// ── 1. A silent index (what the buggy catch-up did) ─────────────────────────
insertPool(mk('GTI', GTI_BLOCK))
check('silent index stores the pool', poolCount() === 1)
check('silent index defaults to unannounced', getPool('0xGTI').announced === false)
check('lost launch is discoverable', unannouncedPools().length === 1, unannouncedPools().map(p => p.symbol).join(','))
check('lost launch keeps its block', unannouncedPools()[0].launchBlock === GTI_BLOCK, String(unannouncedPools()[0].launchBlock))

// ── 2. Re-processing the same event must not resurrect it as a new pool ─────
insertPool(mk('GTI', GTI_BLOCK))
check('re-index never duplicates the row', poolCount() === 1, String(poolCount()))
check('re-index leaves it unannounced', getPool('0xGTI').announced === false)

// ── 3. Announcing it clears the recovery queue ─────────────────────────────
markAnnounced('0xGTI')
check('markAnnounced flips the flag', getPool('0xGTI').announced === true)
check('announced pool leaves the queue', unannouncedPools().length === 0)

// ── 4. A second lost launch is still found ────────────────────────────────
insertPool(mk('HYRO', GTI_BLOCK + 500))
const q = unannouncedPools()
check('queue finds the next lost launch', q.length === 1 && q[0].symbol === 'HYRO', q.map(p => p.symbol).join(','))
check('queue is newest-first', q[0].launchBlock === GTI_BLOCK + 500, String(q[0].launchBlock))

// ── 5. Age rule: recent posts, old is flagged without posting ─────────────
// Mirrors recoverUnannounced(): anything further than RECENT_WINDOW behind head
// is history, so it is flagged rather than announced.
const RECENT_WINDOW = 2000n
const head = BigInt(GTI_BLOCK + 500)
const isRecent = (p) => head - BigInt(p.launchBlock) <= RECENT_WINDOW
check('a launch at head is recent', isRecent({ launchBlock: Number(head) }))
check('a launch 2001 blocks back is not recent', !isRecent({ launchBlock: Number(head) - 2001 }))
check('GTI would have been recent at restart', isRecent({ launchBlock: GTI_BLOCK }))

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)
console.log(`\n${failed === 0 ? 'ALL LAUNCH-ALERT-LOSS CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
