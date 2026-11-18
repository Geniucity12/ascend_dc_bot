import { rmSync, existsSync } from 'node:fs'
import { openDb, getSetting, setSetting } from './src/db.js'

const DB = '/tmp/subscribe-test.db'
for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

openDb(DB)

// The settings table must exist, or every /subscribe throws at runtime.
// (Passing undefined here would trigger getSetting's default param, so assert
// on a real missing key instead.)
check('settings table exists and is empty', getSetting('alert_channel_id', 'MISSING') === 'MISSING')

// Cold start: nothing stored -> fallback wins.
check('cold start uses fallback', getSetting('alert_channel_id', 'env-123') === 'env-123')

// /subscribe writes it.
setSetting('alert_channel_id', '999')
check('persisted value read back', getSetting('alert_channel_id', 'env-123') === '999')
check('DB beats env fallback', getSetting('alert_channel_id', 'env-123') === '999')

// Overwrite (re-running /subscribe must not throw on the conflict).
setSetting('alert_channel_id', '111')
check('overwrite updates in place', getSetting('alert_channel_id', null) === '111')

// /unsubscribe clears it -> fallback resumes.
setSetting('alert_channel_id', null)
check('cleared value falls back', getSetting('alert_channel_id', 'env-123') === 'env-123')

// Simulate a restart: reopen the same file and confirm it survived.
setSetting('alert_channel_id', '555')
openDb(DB)
check('survives a reopen (restart)', getSetting('alert_channel_id', 'env-123') === '555')

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

console.log(`\n${failed === 0 ? 'ALL SUBSCRIBE-PERSISTENCE CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
