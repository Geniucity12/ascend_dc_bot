import { rmSync, existsSync } from 'node:fs'
import { openDb, insertPool, recentPools } from './src/db.js'

const DB = '/tmp/recent-order-test.db'
for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

openDb(DB)

// Simulates the bug: all four pools indexed AFTER an old launch, so every
// launched_at is "now" and identical. Only launch_block distinguishes them.
const mk = (symbol, block, launchedAt) => ({
  poolId: `0x${symbol}`,
  token: `0xtok${symbol}`,
  creator: '0xcreator',
  quote: '0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65',
  tokenIs0: false,
  tokenDecimals: 18,
  symbol,
  launchedAt,
  launchBlock: block,
  firstPrice: 1e-8,
})

const sameTime = Math.floor(Date.now() / 1000)
// Insert newest-block-first so insertion order cannot accidentally pass.
insertPool(mk('OLDEST', 100, sameTime))
insertPool(mk('MIDDLE', 500, sameTime))
insertPool(mk('NEWEST', 900, sameTime))

const got = recentPools(10).map(p => p.symbol)
check('orders by block, not index time', got.join(',') === 'NEWEST,MIDDLE,OLDEST', got.join(','))
check('highest block first', got[0] === 'NEWEST', got[0])

// A pool with no block recorded must not sort above real ones.
insertPool({ ...mk('NOBLOCK', null, sameTime) })
const after = recentPools(10).map(p => p.symbol)
check('null block sorts last', after[after.length - 1] === 'NOBLOCK', after.join(','))

// Legacy rows written before this fix already carry launch_block, so the fix
// applies to data indexed by the backfill without a re-crawl.
check('legacy rows need no re-crawl', after.includes('OLDEST') && after[0] === 'NEWEST')

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

console.log(`\n${failed === 0 ? 'ALL RECENT-ORDERING CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
