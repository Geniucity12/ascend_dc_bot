import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env')
  } catch {
    // older node, or malformed .env — fall through to process.env
  }
}

function req(name) {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.error(`\n[config] Missing required env var: ${name}`)
    console.error(`[config] Copy .env.example to .env and fill it in.\n`)
    process.exit(1)
  }
  return v.trim()
}

function opt(name, fallback) {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function num(name, fallback) {
  const v = process.env[name]
  if (!v || !v.trim()) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) {
    console.error(`[config] ${name} must be a number, got "${v}"`)
    process.exit(1)
  }
  return n
}

function bool(name, fallback) {
  const v = process.env[name]
  if (!v || !v.trim()) return fallback
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())
}

const alchemyKey = req('ALCHEMY_KEY')

export const config = {
  discord: {
    token: req('DISCORD_TOKEN'),
    guildId: opt('GUILD_ID', ''),
    alertChannelId: opt('ALERT_CHANNEL_ID', ''),
  },
  chain: {
    alchemyKey,
    wsUrl: `wss://elysium-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    httpUrl: `https://elysium-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    publicRpcUrl: opt('PUBLIC_RPC_URL', 'https://rpc.elysium.kinetiq.xyz'),
    startBlock: BigInt(num('START_BLOCK', 422319)),
  },
  alerts: {
    minTradeQuote: Number(opt('MIN_TRADE_QUOTE', '0.05')),
    digestSeconds: num('DIGEST_SECONDS', 300),
    digestMinTrades: num('DIGEST_MIN_TRADES', 10),
    digestMinVolume: num('DIGEST_MIN_VOLUME', 5),
    poolCooldownSeconds: num('POOL_COOLDOWN_SECONDS', 8),
    // Discord allows roughly 5 messages/second per channel; this cap is the
  // per-minute expression of that with headroom for the digest embeds that
  // share the channel. The old default of 20/min throttled launch-dense
  // periods hard enough to drop most of them.
  maxAlertsPerMinute: num('MAX_ALERTS_PER_MINUTE', 120),
    launches: bool('ALERT_LAUNCHES', true),
    trades: bool('ALERT_TRADES', true),
  },
  ipfsGateway: opt('IPFS_GATEWAY', 'https://ipfs.io/ipfs/'),
  explorerUrl: opt('EXPLORER_URL', 'https://elysium.kinetiq.xyz/explorer').replace(/\/$/, ''),
  // Where "Buy on Ascend" sends people. The path segment is configurable
  // because the Ascend app's per-token route is theirs to change — if it moves,
  // this is an env var rather than a code change.
  ascendAppUrl: opt('ASCEND_APP_URL', 'https://app.ascendlaunch.xyz').replace(/\/$/, ''),
  ascendTokenPath: opt('ASCEND_TOKEN_PATH', '/token/'),
  // Optional trading-partner deep link. Left empty on purpose: the bot will not
  // invent a partner route it cannot verify. Set e.g.
  // FOMO_URL_TEMPLATE=https://fomo.biz/token/{ca} and the button appears.
  fomoUrlTemplate: opt('FOMO_URL_TEMPLATE', ''),
  dbPath: opt('DB_PATH', './data/ascend.db'),
  logLevel: opt('LOG_LEVEL', 'info'),
}
