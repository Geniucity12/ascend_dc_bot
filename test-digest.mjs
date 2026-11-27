import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ALCHEMY_KEY ??= 'test-key'
process.env.DISCORD_TOKEN ??= 'test-token'
process.env.DIGEST_SECONDS = '600'

let priceRequests = 0
globalThis.fetch = async url => {
  priceRequests++
  const parsedUrl = new URL(url)
  return {
    ok: true,
    json: async () => ({
      hyperliquid: { usd: 60 },
      'usd-coin': { usd: 1 },
      kinetiq: { usd: 0.2 },
      'wrapped-nvidia-xstock': { usd: 150 },
    }),
    requestedIds: parsedUrl.searchParams.get('ids'),
  }
}

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
  const tokens = []

  for (let i = 1; i <= 12; i++) {
    const token = `0x${String(i).padStart(40, '0')}`
    const isKntq = i === 1 || i === 12
    tokens.push(token)
    enqueueTrade({
      poolId: `pool-${i}`,
      token,
      quote: isKntq
        ? '0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0'
        : '0xba876237b0f021a6c6d852d6c26e107997cc5e81',
      symbol: `P${i}`,
      tradeCount: 10,
      volumeQuote: 10,
      firstPrice: 1,
      lastPrice: 1,
    }, {
      quoteAmount: i === 1 ? 1_000 : i,
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
  check('highest USD volume is ranked first', lines[0]?.startsWith('1. [**P11**]'), lines[0])
  check('tenth-highest USD volume is last', lines[9]?.startsWith('10. [**P3**]'), lines[9])
  check('lower USD pool is omitted despite higher raw quote amount', !description.includes('**P12**'))
  check('USD and original quote volume are both shown', lines[8]?.includes('$200') && lines[8]?.includes('1,000 KNTQ'), lines[8])
  check('watched pool keeps its coin-specific digest', messages[1]?.poolToken === tokens[11])
  check('digest buckets clear after flush', pendingDigestCount() === 0)
  check('USD prices are fetched once for the leaderboard', priceRequests === 1, String(priceRequests))
} finally {
  database.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? 'ALL DIGEST CHECKS PASSED' : `${failed} DIGEST CHECK(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
