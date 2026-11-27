import { rmSync, existsSync } from 'node:fs'
import {
  openDb,
  getSetting,
  setSetting,
  getGuildAlertChannelId,
  setGuildAlertChannelId,
  addWatch,
} from './src/db.js'
import { sendAlertToGuilds } from './src/alert-delivery.js'

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

setGuildAlertChannelId('guild-a', 'channel-a')
setGuildAlertChannelId('guild-b', 'channel-b')
check('guild A has its own channel', getGuildAlertChannelId('guild-a') === 'channel-a')
check('guild B has its own channel', getGuildAlertChannelId('guild-b') === 'channel-b')
check('one guild setting does not overwrite another', getGuildAlertChannelId('guild-a') === 'channel-a')
setGuildAlertChannelId('guild-a', null)
check('unsubscribe clears even the configured fallback', getGuildAlertChannelId('guild-a', 'env-channel') === null)
check('other guild setting survives unsubscribe', getGuildAlertChannelId('guild-b') === 'channel-b')

const token = '0x0000000000000000000000000000000000000001'
addWatch('guild-a', 'user-a', token, 'channel-a')
addWatch('guild-b', 'user-b', token, 'channel-b')
const sent = new Map()
const channels = new Map(
  ['channel-a', 'channel-b'].map((id, i) => {
    const guildId = i === 0 ? 'guild-a' : 'guild-b'
    sent.set(id, [])
    return [id, {
      guildId,
      isTextBased: () => true,
      send: async payload => sent.get(id).push(payload),
    }]
  }),
)
const client = { channels: { fetch: async id => channels.get(id) ?? null } }
await sendAlertToGuilds(client, new Map([
  ['guild-a', 'channel-a'],
  ['guild-b', 'channel-b'],
]), { embeds: ['alert'], poolToken: token })
check('broadcast sends alert to both guild channels', sent.get('channel-a').length === 2 && sent.get('channel-b').length === 2)
check('watcher ping is scoped to its own guild', sent.get('channel-a')[1]?.content === '<@user-a>' && sent.get('channel-b')[1]?.content === '<@user-b>')

await sendAlertToGuilds(client, new Map([
  ['guild-a', 'channel-a'],
  ['guild-b', 'channel-b'],
]), { embeds: ['private-watch-update'], targetGuildIds: ['guild-b'] })
check('targeted watch update only reaches requested guild', sent.get('channel-a').length === 2 && sent.get('channel-b').length === 3)

for (const ext of ['', '-shm', '-wal']) if (existsSync(DB + ext)) rmSync(DB + ext)

console.log(`\n${failed === 0 ? 'ALL SUBSCRIBE-PERSISTENCE CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
