import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from './logger.js'

let db

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true })
  db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  migrate()
  log.info(`db ready at ${path}`)
  return db
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      pool_id        TEXT PRIMARY KEY,
      token          TEXT NOT NULL,
      creator        TEXT NOT NULL,
      quote          TEXT NOT NULL,
      token_is0      INTEGER NOT NULL,
      token_decimals INTEGER NOT NULL DEFAULT 18,
      name           TEXT,
      symbol         TEXT,
      image_uri      TEXT,
      fee_pips       INTEGER,
      builder_fee    INTEGER,
      dev_buy        TEXT,
      launched_at    INTEGER,
      launch_block   INTEGER,
      first_price    REAL,
      last_price     REAL,
      high_price     REAL,
      low_price      REAL,
      trade_count    INTEGER NOT NULL DEFAULT 0,
      volume_quote   REAL NOT NULL DEFAULT 0,
      escrow         TEXT,
      last_alert_at  INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_pools_launched ON pools(launched_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pools_token ON pools(token)')

  db.exec(`
    CREATE TABLE IF NOT EXISTS cursors (
      key        TEXT PRIMARY KEY,
      block      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS watches (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      token      TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, token)
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_watches_token ON watches(token)')

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_events (
      id         TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )
  `)

db.exec(`
 CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
 )
`)
}

function hydrate(row) {
  return {
    poolId: row.pool_id,
    token: row.token,
    creator: row.creator,
    quote: row.quote,
    tokenIs0: row.token_is0 === 1,
    tokenDecimals: row.token_decimals,
    name: row.name,
    symbol: row.symbol,
    imageUri: row.image_uri,
    feePips: row.fee_pips,
    builderFee: row.builder_fee,
    devBuy: row.dev_buy,
    launchedAt: row.launched_at,
    launchBlock: row.launch_block,
    firstPrice: row.first_price,
    lastPrice: row.last_price,
    highPrice: row.high_price,
    lowPrice: row.low_price,
    tradeCount: row.trade_count,
    volumeQuote: row.volume_quote,
    escrow: row.escrow,
    lastAlertAt: row.last_alert_at,
  }
}

// ─── Cursors ────────────────────────────────────────────────────────────────

export function getCursor(key, fallback) {
  const row = db.prepare('SELECT block FROM cursors WHERE key = ?').get(key)
  return row ? BigInt(row.block) : fallback
}

export function setCursor(key, block) {
  db.prepare(
    `INSERT INTO cursors (key, block, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET block = excluded.block, updated_at = excluded.updated_at`,
  ).run(key, block.toString(), Date.now())
}

// ─── Pools ──────────────────────────────────────────────────────────────────

export function insertPool(p) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO pools (
       pool_id, token, creator, quote, token_is0, token_decimals,
       name, symbol, image_uri, fee_pips, builder_fee, dev_buy,
       launched_at, launch_block, first_price, last_price, high_price,
       low_price, trade_count, volume_quote, escrow, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)
     ON CONFLICT(pool_id) DO NOTHING`,
  ).run(
    p.poolId, p.token, p.creator, p.quote, p.tokenIs0 ? 1 : 0, p.tokenDecimals,
    p.name ?? null, p.symbol ?? null, p.imageUri ?? null,
    p.feePips ?? null, p.builderFee ?? null, p.devBuy ?? '0',
    p.launchedAt ?? Math.floor(now / 1000), p.launchBlock ?? null,
    p.firstPrice ?? null, p.firstPrice ?? null, p.firstPrice ?? null,
    p.firstPrice ?? null, p.escrow ?? null, now,
  )
}

const UPDATABLE = new Set([
  'name', 'symbol', 'image_uri', 'fee_pips', 'builder_fee', 'dev_buy',
  'launched_at', 'launch_block', 'first_price', 'last_price', 'high_price',
  'low_price', 'trade_count', 'volume_quote', 'escrow', 'last_alert_at',
  'token_decimals',
])

export function updatePool(poolId, fields) {
  const entries = Object.entries(fields).filter(([k]) => UPDATABLE.has(k))
  if (!entries.length) return
  const set = entries.map(([k]) => `${k} = ?`).join(', ')
  db.prepare(`UPDATE pools SET ${set} WHERE pool_id = ?`)
    .run(...entries.map(([, v]) => v), poolId)
}

export function getPool(poolId) {
  const row = db.prepare('SELECT * FROM pools WHERE pool_id = ?').get(poolId)
  return row ? hydrate(row) : null
}

export function getPoolByToken(token) {
  const row = db.prepare('SELECT * FROM pools WHERE token = ? COLLATE NOCASE').get(token)
  return row ? hydrate(row) : null
}

/** Record a trade and refresh the pool's running stats. */
export function recordTrade(poolId, { price, volumeQuote }) {
  const pool = getPool(poolId)
  if (!pool) return null
  const high = pool.highPrice == null ? price : Math.max(pool.highPrice, price)
  const low = pool.lowPrice == null ? price : Math.min(pool.lowPrice, price)
  db.prepare(
    `UPDATE pools SET
       last_price = ?, high_price = ?, low_price = ?,
       first_price = COALESCE(first_price, ?),
       trade_count = trade_count + 1,
       volume_quote = volume_quote + ?
     WHERE pool_id = ?`,
  ).run(price, high, low, price, volumeQuote ?? 0, poolId)
  return {
    ...pool,
    lastPrice: price,
    highPrice: high,
    lowPrice: low,
    firstPrice: pool.firstPrice ?? price,
    tradeCount: pool.tradeCount + 1,
    volumeQuote: pool.volumeQuote + (volumeQuote ?? 0),
  }
}

export function recentPools(limit = 10) {
  return db
    .prepare('SELECT * FROM pools ORDER BY COALESCE(launch_block, 0) DESC, launched_at DESC LIMIT ?')
    .all(limit)
    .map(hydrate)
}

export function topPools(limit = 10) {
  return db
    .prepare('SELECT * FROM pools ORDER BY volume_quote DESC LIMIT ?')
    .all(limit)
    .map(hydrate)
}

// ─── Settings ───────────────────────────────────────────────────────────────
// Small key/value store for state that has to survive a restart. Notably the
// alert channel: /subscribe used to assign it to an in-memory object, so every
// redeploy silently reverted the channel and the bot kept replying
// "Subscribed" while posting nowhere.

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setSetting(key, value) {
  if (value == null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value))
}

// ─── Watchlist ──────────────────────────────────────────────────────────────

export function addWatch(guildId, userId, token, channelId) {
  db.prepare(
    `INSERT INTO watches (guild_id, user_id, token, channel_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, token) DO UPDATE SET channel_id = excluded.channel_id`,
  ).run(guildId, userId, token.toLowerCase(), channelId, Date.now())
}

export function removeWatch(userId, token) {
  const r = db
    .prepare('DELETE FROM watches WHERE user_id = ? AND token = ? COLLATE NOCASE')
    .run(userId, token)
  return r.changes > 0
}

export function listWatches(userId) {
  return db
    .prepare('SELECT * FROM watches WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
}

export function watchersOf(token) {
  return db
    .prepare('SELECT * FROM watches WHERE token = ? COLLATE NOCASE')
    .all(token)
}

// ─── Dedupe ─────────────────────────────────────────────────────────────────

/**
 * Returns true if this event id is new. Prevents double-posting when a
 * reconnect replays logs overlapping the backfill range.
 */
export function markSeen(id) {
  const r = db
    .prepare('INSERT INTO seen_events (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING')
    .run(id, Date.now())
  return r.changes > 0
}

export function pruneSeen(maxAgeMs = 24 * 60 * 60 * 1000) {
  db.prepare('DELETE FROM seen_events WHERE created_at < ?').run(Date.now() - maxAgeMs)
}

