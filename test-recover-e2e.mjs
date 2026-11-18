process.env.ALCHEMY_KEY ??= 'test-key'
process.env.DISCORD_TOKEN ??= 'test-token'
process.env.ALERT_LAUNCHES = 'true'

const { rmSync, existsSync } = await import('node:fs')
const DB = '/tmp/recover-e2e.db'
for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

const db = await import('./src/db.js')
db.openDb(DB)
const { recoverUnannounced } = await import('./src/watcher.js')

let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

const mk = (sym, block) => ({
  poolId: `0x${sym}`, token: `0xt${sym}`, creator: '0xc',
  quote: '0xba876237b0f021a6c6d852d6c26e107997cc5e81',
  tokenIs0: false, tokenDecimals: 18, symbol: sym,
  launchedAt: Math.floor(Date.now() / 1000), launchBlock: block, firstPrice: 1e-8,
})

const sent = []
const send = async (msg) => { sent.push(msg) }

// HEAD is 500 blocks past GTI's launch — inside RECENT_WINDOW, so it is
// actionable and must be posted.
const GTI = 7967905
const HEAD = BigInt(GTI + 500)
db.insertPool(mk('GTI', GTI))

const recovered = await recoverUnannounced(send, HEAD)
check('recent lost launch is announced', recovered === 1, String(recovered))
check('exactly one embed sent', sent.length === 1, String(sent.length))
check('send carried an embed', !!sent[0]?.embeds?.[0])
check('watch ping has the token', sent[0]?.poolToken === '0xtGTI', String(sent[0]?.poolToken))
check('pool now marked announced', db.getPool('0xGTI').announced === true)
check('second run sends nothing', (await recoverUnannounced(send, HEAD)) === 0, String(sent.length))

// Old history must be flagged WITHOUT posting — announcing a two-week-old
// launch would read as a fresh launch.
db.insertPool(mk('ANCIENT', GTI - 50_000))
const before = sent.length
const rec2 = await recoverUnannounced(send, HEAD)
check('old launch is not announced', rec2 === 0, String(rec2))
check('old launch posted nothing', sent.length === before, `${sent.length} vs ${before}`)
check('old launch was flagged instead', db.getPool('0xANCIENT').announced === true)
check('queue is now empty', db.unannouncedPools().length === 0)

// A failing send must leave the launch recoverable, not marked posted.
db.insertPool(mk('FAILS', GTI + 10))
const boom = async () => { throw new Error('discord down') }
const rec3 = await recoverUnannounced(boom, HEAD)
check('failed send announces nothing', rec3 === 0, String(rec3))
check('failed send stays recoverable', db.getPool('0xFAILS').announced === false)
check('retry after failure works', (await recoverUnannounced(send, HEAD)) === 1)

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)
console.log(`\n${failed === 0 ? 'ALL RECOVER-E2E CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
