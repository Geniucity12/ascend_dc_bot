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
    maxAlertsPerMinute: num('MAX_ALERTS_PER_MINUTE', 20),
    launches: bool('ALERT_LAUNCHES', true),
    trades: bool('ALERT_TRADES', true),
  },
  ipfsGateway: opt('IPFS_GATEWAY', 'https://ipfs.io/ipfs/'),
  explorerUrl: opt('EXPLORER_URL', 'https://elysium.kinetiq.xyz/explorer').replace(/\/$/, ''),
  dbPath: opt('DB_PATH', './data/ascend.db'),
  logLevel: opt('LOG_LEVEL', 'info'),
}
