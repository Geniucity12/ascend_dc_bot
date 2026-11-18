import { rmSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { openDb, getPool, insertPool, unannouncedPools } from './src/db.js'

// Verifies the migration on a volume that PREDATES the announced column — i.e.
// the live Railway volume. A blind ALTER TABLE would crash every restart, so
// this has to be exercised against a real legacy schema.

const DB = '/tmp/legacy-migrate.db'
for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

// Build the OLD schema by hand: no `announced`.
const legacy = new DatabaseSync(DB)
legacy.exec(`
CREATE TABLE pools (
 pool_id TEXT PRIMARY KEY,
 token TEXT NOT NULL,
 creator TEXT NOT NULL,
 quote TEXT NOT NULL,
 token_is0 INTEGER NOT NULL,
 token_decimals INTEGER NOT NULL DEFAULT 18,
 name TEXT, symbol TEXT, image_uri TEXT,
 fee_pips INTEGER, builder_fee INTEGER, dev_buy TEXT,
 launched_at INTEGER, launch_block INTEGER,
 first_price REAL, last_price REAL, high_price REAL, low_price REAL,
 trade_count INTEGER NOT NULL DEFAULT 0,
 volume_quote REAL NOT NULL DEFAULT 0,
 escrow TEXT,
 last_alert_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
)`)
legacy.prepare(
  `INSERT INTO pools (pool_id, token, creator, quote, token_is0, created_at)
   VALUES ('0xLEGACY', '0xold', '0xc', '0xbA876237B0F021A6c6D852d6c26E107997cC5E81', 0, 1)`,
).run()
const cols = legacy.prepare('PRAGMA table_info(pools)').all().map(c => c.name)
check('legacy DB really lacks announced', !cols.includes('announced'))
legacy.close()

// Opening through openDb() must migrate in place, not throw.
let opened = true
try {
  openDb(DB)
} catch (e) {
  opened = false
  console.log(`  openDb threw: ${e.message}`)
}
check('openDb migrates a legacy volume', opened)

if (opened) {
  const after = new DatabaseSync(DB).prepare('PRAGMA table_info(pools)').all().map(c => c.name)
  check('announced column added', after.includes('announced'))

  const row = getPool('0xLEGACY')
  check('legacy row still readable', row && row.poolId === '0xLEGACY')
  check('legacy row defaults to unannounced', row.announced === false)

  // Existing pools must not be re-announced en masse: recoverUnannounced()
  // flags anything older than RECENT_WINDOW without posting. Here we assert the
  // data path that makes that decision possible.
  const q = unannouncedPools()
  check('legacy pool enters the recovery queue', q.length === 1 && q[0].poolId === '0xLEGACY', String(q.length))
  check('legacy pool has a launch block slot', 'launchBlock' in q[0])
}

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)
console.log(`\n${failed === 0 ? 'ALL LEGACY-MIGRATION CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
