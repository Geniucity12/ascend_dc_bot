process.env.ALCHEMY_KEY ??= 'test-key'
process.env.DISCORD_TOKEN ??= 'test-token'

const { launchMessage, quickBuyRows } = await import('./src/render.js')

let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

const CA = '0xAb3b504e09c3B2bC08F369Db4dE1071b8192bd28'
const pool = {
  poolId: '0xpool',
  token: CA,
  creator: '0xcreator',
  quote: '0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65',
  tokenIs0: false,
  tokenDecimals: 18,
  name: 'Test',
  symbol: 'TST',
  feePips: 3000,
  devBuy: '0',
  firstPrice: 1e-8,
}

const rows = quickBuyRows(pool)
check('one action row', rows.length === 1, String(rows.length))

const json = rows[0].toJSON()
const buttons = json.components
check('two buttons by default', buttons.length === 2, String(buttons.length))
check('all buttons are link style', buttons.every(b => b.style === 5), buttons.map(b => b.style).join(','))

const buy = buttons.find(b => b.label === 'Buy on Ascend')
check('buy button exists', !!buy)
check('buy button carries the contract address', buy?.url?.endsWith(CA), buy?.url)
check('buy button uses the plural /tokens/ route', buy?.url === `https://app.ascendlaunch.xyz/tokens/${CA}`, buy?.url)

const chart = buttons.find(b => b.label === 'View Chart')
check('chart button exists', !!chart)
check('chart button uses the singular /token/ route', chart?.url === `https://app.ascendlaunch.xyz/token/${CA}`, chart?.url)
check('buy and chart are different routes', buy?.url !== chart?.url)

// Fomo is opt-in: the bot must not invent a partner route it cannot verify.
check('no Fomo button without a template', !buttons.some(b => b.label === 'Trade on Fomo'))

// ...but when a template is configured the button must appear with the CA
// substituted. config is read at import time, so this needs a child process.
const { execFileSync } = await import('node:child_process')
const fomoOut = execFileSync(process.execPath, [
  '--disable-warning=ExperimentalWarning',
  '--input-type=module',
  '-e',
  `const { quickBuyRows } = await import('./src/render.js')
   const b = quickBuyRows({ token: '${CA}' })[0].toJSON().components
   console.log(JSON.stringify(b.map(x => [x.label, x.url])))`,
], { env: { ...process.env, FOMO_URL_TEMPLATE: 'https://fomo.example/t/{ca}' }, encoding: 'utf8' })

const fomoButtons = JSON.parse(fomoOut.trim())
const fomo = fomoButtons.find(([label]) => label === 'Trade on Fomo')
check('Fomo button appears when configured', !!fomo, JSON.stringify(fomoButtons))
check('Fomo url has the CA substituted', fomo?.[1] === `https://fomo.example/t/${CA}`, fomo?.[1])
check('Fomo button sits between buy and chart', fomoButtons[1]?.[0] === 'Trade on Fomo', fomoButtons.map(b => b[0]).join(','))

// A pool with no token cannot produce a link, and a button with an empty URL
// makes Discord reject the whole message — so the row must be omitted.
check('no rows without a token', quickBuyRows({ ...pool, token: null }).length === 0)
check('no rows for a missing pool', quickBuyRows(null).length === 0)

// The message wrapper is what the watcher actually sends.
const msg = launchMessage({ pool, metadata: null, txHash: '0xdead' })
check('message carries an embed', msg.embeds.length === 1)
check('message carries the buttons', msg.components.length === 1)
check('message carries the watch token', msg.poolToken === CA, msg.poolToken)

// Trade digests must carry the same buttons: a digest is the moment someone
// sees a pool moving, which is exactly when they want to buy it.
const { digestMessage } = await import('./src/render.js')
const dmsg = digestMessage({
  pool,
  buys: 3,
  sells: 1,
  buyVolume: 2,
  sellVolume: 0.5,
  largest: { isBuy: true, quoteAmount: 1.5 },
})
check('digest carries an embed', dmsg.embeds.length === 1)
check('digest carries the buttons', dmsg.components.length === 1)
check('digest buy button has the CA', dmsg.components[0].toJSON().components[0].url.endsWith(CA))
check('digest carries the watch token', dmsg.poolToken === CA, dmsg.poolToken)

// Every URL must be a valid absolute https URL or Discord 400s the send.
const urls = msg.components[0].toJSON().components.map(b => b.url)
check('all urls are https', urls.every(u => u.startsWith('https://')), urls.join(' '))
check('no url exceeds 512 chars', urls.every(u => u.length <= 512))

console.log(`\n${failed === 0 ? 'ALL QUICK-BUY CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
