import { readFileSync } from 'node:fs'

// Static verification of the silent-backfill wiring: these are the exact
// conditions that caused two weeks of launches to be replayed into Discord.
const watcher = readFileSync('src/watcher.js', 'utf8')
const backfill = readFileSync('src/backfill.js', 'utf8')
const dbSrc = readFileSync('src/db.js', 'utf8')
const indexSrc = readFileSync('src/index.js', 'utf8')

const checks = [
  ['processLogs accepts silent', /export async function processLogs\([^)]*silent = false\)/.test(watcher)],
  ['processLogs forwards silent to handleLaunch', /handleLaunch\(rawLog, send, res, silent\)/.test(watcher)],
  ['processLogs forwards silent to handleSwap', /handleSwap\(rawLog, send, res, silent\)/.test(watcher)],
  ['handleLaunch returns before send when silent', /if \(silent\) return[\s\S]{0,400}await send\(/.test(watcher)],
  ['handleSwap returns before digest when silent', /if \(silent\) return[\s\S]{0,600}enqueueTrade/.test(watcher)],
  ['backfill calls processLogs silently', /processLogs\(launchLogs, send, res, true\)/.test(backfill)],
  ['backfill calls swap processLogs silently', /processLogs\(swapLogs, send, res, true\)/.test(backfill)],
// The 2000-block SPAN test was the bug: a restart landing ~13 min behind head
// silenced every launch in the gap, permanently. Silence now depends on each
// log's distance from head, not the width of the range being walked.
['reconcile no longer silences on span', !/catchingUp = span > RECENT_WINDOW/.test(watcher)],
['reconcile classifies per-log by age', /isRecent = \(l\) => .*to - l\.blockNumber <= RECENT_WINDOW/.test(watcher)],
['reconcile still silences old launches', /processLogs\(oldLaunches, send, res, true\)/.test(watcher)],
['reconcile announces recent launches', /processLogs\(recentLaunches, send, res, false\)/.test(watcher)],

// Recovery: a launch indexed silently must stay postable later.
['pools have an announced column', /announced INTEGER NOT NULL DEFAULT 0/.test(dbSrc)],
["announced migrates onto old volumes", /addColumn\('pools', 'announced'/.test(dbSrc)],
['markAnnounced exists', /export function markAnnounced/.test(dbSrc)],
['unannouncedPools exists', /export function unannouncedPools/.test(dbSrc)],
['handleLaunch recovers unannounced pools', /existing\.announced/.test(watcher)],
['recovery wired at startup', /recoverUnannounced\(sendAlert/.test(indexSrc)],

// Escrow launches were decoded but never routed, so they were invisible.
['EscrowLaunched is routed', /TOPIC\.EscrowLaunched\) \{/.test(watcher)],
['escrow handler defined', /async function handleEscrowLaunch/.test(watcher)],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed++
}

// Ordering matters: for a freshly-indexed launch the silent guard must run
// BEFORE the announce send. Measured from insertPool onward, because the
// recovery branch above it is allowed to post an already-indexed pool.
const launchBody = watcher.slice(watcher.indexOf('async function handleLaunch'))
const afterInsert = launchBody.slice(launchBody.indexOf('insertPool(pool)'))
const sendIdx = afterInsert.indexOf('await send(')
const silentIdx = afterInsert.indexOf('if (silent) return')
console.log(`${silentIdx !== -1 && silentIdx < sendIdx ? 'PASS' : 'FAIL'} launch silent-guard precedes send()`)
if (!(silentIdx !== -1 && silentIdx < sendIdx)) failed++

const swapBody = watcher.slice(watcher.indexOf('async function handleSwap'))
const enqueueIdx = swapBody.indexOf('enqueueTrade')
const swapSilentIdx = swapBody.indexOf('if (silent) return')
console.log(`${swapSilentIdx !== -1 && swapSilentIdx < enqueueIdx ? 'PASS' : 'FAIL'} swap silent-guard precedes enqueueTrade()`)
if (!(swapSilentIdx !== -1 && swapSilentIdx < enqueueIdx)) failed++

console.log(`\n${failed === 0 ? 'ALL SILENT-PATH CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
