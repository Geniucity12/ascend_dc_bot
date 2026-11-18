import { rmSync, existsSync } from 'node:fs'
import { openDb, insertPool, recentPools, poolCount, historyFloor, setCursor } from './src/db.js'

const DB = '/tmp/gap-test.db'
for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

openDb(DB)
const t = Math.floor(Date.now() / 1000)
const mk = (sym, block) => ({
  poolId: `0x${sym}`, token: `0xt${sym}`, creator: '0xc',
  quote: '0xba876237b0f021a6c6d852d6c26e107997cc5e81',
  tokenIs0: false, tokenDecimals: 18, symbol: sym,
  launchedAt: t, launchBlock: block, firstPrice: 1e-8,
})

// Reproduce the real DB: today's live launch at the head, plus the tail of the
// old forward crawl which stopped around block 5,000,000.
insertPool(mk('HBUL', 7951000))       // today
insertPool(mk('liquititty', 6600000)) // ~1 week, end of old crawl
insertPool(mk('Montra', 6599000))
insertPool(mk('OLDEST', 422320))      // deploy block

const got = recentPools(10).map(p => [p.symbol, p.launchBlock])
check('strictly descending by block', got.every(([, b], i) => i === 0 || got[i - 1][1] >= b), JSON.stringify(got))
check('newest launch is first', got[0][0] === 'HBUL', got[0][0])
check('oldest crawl result last', got.at(-1)[0] === 'OLDEST', got.at(-1)[0])
check('launchBlock exposed for display', got[0][1] === 7951000, String(got[0][1]))

check('poolCount reports rows', poolCount() === 4, String(poolCount()))
check('historyFloor null before crawl', historyFloor() === null)
setCursor('backfill_desc', 6600000n)
check('historyFloor reads low-water mark', historyFloor() === 6600000, String(historyFloor()))

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)
console.log(`\n${failed === 0 ? 'ALL GAP-VISIBILITY CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
