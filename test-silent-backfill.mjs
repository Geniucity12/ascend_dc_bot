import { readFileSync } from 'node:fs'

// Static verification of the silent-backfill wiring: these are the exact
// conditions that caused two weeks of launches to be replayed into Discord.
const watcher = readFileSync('src/watcher.js', 'utf8')
const backfill = readFileSync('src/backfill.js', 'utf8')

const checks = [
  ['processLogs accepts silent', /export async function processLogs\([^)]*silent = false\)/.test(watcher)],
  ['processLogs forwards silent to handleLaunch', /handleLaunch\(rawLog, send, res, silent\)/.test(watcher)],
  ['processLogs forwards silent to handleSwap', /handleSwap\(rawLog, send, res, silent\)/.test(watcher)],
  ['handleLaunch returns before send when silent', /if \(silent\) return[\s\S]{0,400}await send\(/.test(watcher)],
  ['handleSwap returns before digest when silent', /if \(silent\) return[\s\S]{0,600}enqueueTrade/.test(watcher)],
  ['backfill calls processLogs silently', /processLogs\(launchLogs, send, res, true\)/.test(backfill)],
  ['backfill calls swap processLogs silently', /processLogs\(swapLogs, send, res, true\)/.test(backfill)],
  ['reconcile silences long catch-ups', /const catchingUp = span > RECENT_WINDOW/.test(watcher)],
  ['reconcile passes catchingUp', /processLogs\(launches, send, res, catchingUp\)/.test(watcher)],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed++
}

// Ordering matters: the silent guard must appear BEFORE the send call.
const launchBody = watcher.slice(watcher.indexOf('async function handleLaunch'))
const sendIdx = launchBody.indexOf('await send(')
const silentIdx = launchBody.indexOf('if (silent) return')
console.log(`${silentIdx !== -1 && silentIdx < sendIdx ? 'PASS' : 'FAIL'} launch silent-guard precedes send()`)
if (!(silentIdx !== -1 && silentIdx < sendIdx)) failed++

const swapBody = watcher.slice(watcher.indexOf('async function handleSwap'))
const enqueueIdx = swapBody.indexOf('enqueueTrade')
const swapSilentIdx = swapBody.indexOf('if (silent) return')
console.log(`${swapSilentIdx !== -1 && swapSilentIdx < enqueueIdx ? 'PASS' : 'FAIL'} swap silent-guard precedes enqueueTrade()`)
if (!(swapSilentIdx !== -1 && swapSilentIdx < enqueueIdx)) failed++

console.log(`\n${failed === 0 ? 'ALL SILENT-PATH CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
