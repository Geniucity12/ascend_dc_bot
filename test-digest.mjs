import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ALCHEMY_KEY ??= 'test-key'
process.env.DISCORD_TOKEN ??= 'test-token'
process.env.DIGEST_SECONDS = '600'

const { openDb, addWatch } = await import('./src/db.js')
const { startDigest, enqueueTrade, flushDigest, pendingDigestCount } = await import('./src/digest.js')

const dir = mkdtempSync(join(tmpdir(), 'ascend-digest-test-'))
const database = openDb(join(dir, 'test.db'))
let failed = 0

const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

try {
  const quote = '0xba876237b0f021a6c6d852d6c26e107997cc5e81'
  const tokens = []

  for (let i = 1; i <= 12; i++) {
    const token = `0x${String(i).padStart(40, '0')}`
    tokens.push(token)
    enqueueTrade({
      poolId: `pool-${i}`,
      token,
      quote,
      symbol: `P${i}`,
      tradeCount: 10,
      volumeQuote: 10,
      firstPrice: 1,
      lastPrice: 1,
    }, {
      quoteAmount: i,
      isBuy: true,
      price: 1,
      tokenAmount: 100,
      mcap: 1_000,
    })
  }

  addWatch('guild', 'watcher-12', tokens[11], 'channel')
  const messages = []
  startDigest(async message => messages.push(message))
  await flushDigest()

  check('all buckets produce one combined leaderboard', messages.length === 2, String(messages.length))
  const description = messages[0]?.embeds[0]?.toJSON().description ?? ''
  const lines = description.split('\n')
  check('leaderboard contains exactly ten entries', lines.length === 10, String(lines.length))
  check('highest window volume is ranked first', lines[0]?.startsWith('1. [**P12**]'), lines[0])
  check('tenth-highest window volume is last', lines[9]?.startsWith('10. [**P3**]'), lines[9])
  check('pool below the top ten is omitted', !description.includes('**P2**'))
  check('watched pool keeps its coin-specific digest', messages[1]?.poolToken === tokens[11])
  check('digest buckets clear after flush', pendingDigestCount() === 0)
} finally {
  database.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? 'ALL DIGEST CHECKS PASSED' : `${failed} DIGEST CHECK(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
