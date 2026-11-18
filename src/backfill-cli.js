import { config } from './config.js'
import { log, setLevel } from './logger.js'
import { openDb } from './db.js'
import { startBackfill } from './backfill.js'

// One-shot indexing run: `npm run backfill`. Walks START_BLOCK → head in
// resumable batches and exits. Safe to re-run — it resumes from the cursor.
setLevel(config.logLevel)
openDb(config.dbPath)

// There is no Discord client in a CLI run, so alerts are dropped rather than
// posted. The point of a backfill is the database, not the channel.
const noop = async () => {}

log.info(`backfill (cli) from block ${config.chain.startBlock}`)

try {
  await startBackfill(noop)
  log.info('backfill (cli) finished')
  process.exit(0)
} catch (e) {
  log.error(`backfill (cli) failed: ${e.message}`)
  process.exit(1)
}
