import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js'
import { createServer } from 'node:http'
import { isAbsolute, resolve } from 'node:path'

import { config } from './config.js'
import { log, setLevel } from './logger.js'
import { openDb } from './db.js'
import { commands } from './commands.js'
import { handleCommand } from './handlers.js'
import { sendAlertToGuilds } from './alert-delivery.js'
import { reconcile, startLive, recoverUnannounced } from './watcher.js'
import {
  pruneSeen,
  getSetting,
  getGuildAlertChannelId,
} from './db.js'
import { infoEmbed } from './render.js'
import { quoteInfo } from './constants.js'
import { fmtAmount, fmtPrice, marketCap } from './price.js'
import { getHead } from './chain.js'
import { startDigest } from './digest.js'
import { startBackfill } from './backfill.js'

setLevel(config.logLevel)

// A DB written inside the container (rather than on a mounted volume) looks
// fine until the first redeploy silently wipes it. Warn early and loudly.
function warnIfEphemeral(dbPath) {
  const abs = isAbsolute(dbPath) ? dbPath : resolve(process.cwd(), dbPath)
  const mounted = process.env.RAILWAY_VOLUME_MOUNT_PATH
  const persistent = mounted ? abs.startsWith(resolve(mounted)) : isAbsolute(dbPath)
  if (persistent) return
  log.warn(`DB_PATH=${dbPath} is not on a persistent volume — data will be lost on redeploy`)
  if (mounted) log.warn(`point DB_PATH inside RAILWAY_VOLUME_MOUNT_PATH (${mounted})`)
}

warnIfEphemeral(config.dbPath)

openDb(config.dbPath)

const state = { alertChannelIds: new Map() }

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
})

/**
 * Sends alerts to each configured guild channel, then pings that guild's
 * watchers separately so the embed stays clean.
 */
async function sendAlert(payload) {
  return sendAlertToGuilds(client, state.alertChannelIds, payload)
}

client.once(Events.ClientReady, async (c) => {
  log.info(`logged in as ${c.user.tag}`)

  // Auto-discover the guild so GUILD_ID is optional.
  const guilds = [...c.guilds.cache.values()]
  if (!guilds.length) {
    log.error('bot is in no servers — invite it first, then restart')
    process.exit(1)
  }

  log.info(`in ${guilds.length} server(s): ${guilds.map(g => `${g.name} (${g.id})`).join(', ')}`)

  // Keep the legacy single-channel setting working for the guild that owns
  // that channel. New /subscribe choices are stored independently per guild.
  const legacyChannelId = getSetting('alert_channel_id', config.discord.alertChannelId || null)
  let legacyGuildId = null
  if (legacyChannelId) {
    const legacyChannel = await c.channels.fetch(legacyChannelId).catch(() => null)
    legacyGuildId = legacyChannel?.guildId ?? (guilds.length === 1 ? guilds[0].id : null)
  }
  for (const guild of guilds) {
    const fallback = guild.id === legacyGuildId ? legacyChannelId : null
    const channelId = getGuildAlertChannelId(guild.id, fallback)
    if (channelId) state.alertChannelIds.set(guild.id, channelId)
    else log.warn(`no alerts channel configured for ${guild.name}; run /subscribe in that server`)
  }

  const targetGuildId = config.discord.guildId || (guilds.length === 1 ? guilds[0].id : null)

  try {
    if (targetGuildId) {
      await c.application.commands.set(commands, targetGuildId)
      log.info(`registered ${commands.length} commands in guild ${targetGuildId}`)
    } else {
      await c.application.commands.set(commands)
      log.info(`registered ${commands.length} commands globally`)
    }
  } catch (e) {
    log.error(`command registration failed: ${e.message}`)
  }

  // List available channels for each server that still needs a destination.
  for (const guild of guilds.filter(g => !state.alertChannelIds.has(g.id))) {
    const channels = guild.channels.cache
      .filter(ch => ch.isTextBased() && ch.permissionsFor?.(c.user)?.has('SendMessages'))
      .map(ch => `• #${ch.name} — \`${ch.id}\``)
      .slice(0, 20)
      .join('\n')

    log.warn(`Pick an alerts channel in ${guild.name} and run /subscribe there:`)
    log.warn(`\n${channels}\n`)
  }

  c.user.setPresence({
    activities: [{ name: 'Ascend launches', type: ActivityType.Watching }],
    status: 'online',
  })

 // Recovery runs before reconcile: a previous process can have indexed a launch
 // while suppressing the post (a restart that landed behind head did exactly
 // that to GTI), leaving a pool row with announced = 0 that no later pass would
 // ever post. Then catch up on anything missed while offline, and go live.
 const startupHead = await getHead().catch(() => null)
 const recovered = await recoverUnannounced(sendAlert, startupHead).catch((e) => {
  log.error(`recover unannounced: ${e.message}`)
  return 0
 })
 if (recovered) log.info(`recovered ${recovered} missed launch alert(s)`)

 await reconcile(sendAlert)
  startLive(sendAlert)
 startBackfill(sendAlert).catch(e => log.error(`backfill: ${e.message}`))
 startDigest(sendAlert)

  setInterval(() => pruneSeen(), 60 * 60 * 1000)

  // Safety net: the socket can die silently when the machine sleeps, and a
  // sparse live stream alone will not reveal the gap. Reconcile on a timer so
  // missed blocks are always recovered.
  setInterval(() => {
    reconcile(sendAlert).catch(e => log.error(`periodic reconcile: ${e.message}`))
  }, 5 * 60 * 1000)

  // Heartbeat: proves the process is alive and the chain is advancing even
  // when nothing is launching or trading.
  setInterval(async () => {
    const head = await getHead().catch(() => null)
    log.info(`heartbeat · head=${head ?? '?'} · configured alert servers=${state.alertChannelIds.size}`)
  }, 5 * 60 * 1000)
})

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  await handleCommand(interaction, state)
})

client.on(Events.Error, (e) => log.error(`client error: ${e.message}`))

process.on('unhandledRejection', (e) => log.error(`unhandled rejection: ${e?.message ?? e}`))
process.on('uncaughtException', (e) => log.error(`uncaught exception: ${e?.message ?? e}`))

// Hosts expose a port and will kill a process that never binds one. The bot
// itself has no HTTP surface, so this answers liveness probes and nothing else.
if (process.env.PORT) {
  createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`ok · ${client.user?.tag ?? 'connecting'}\n`)
  }).listen(process.env.PORT, () => log.info(`health server on :${process.env.PORT}`))
}

process.on('SIGINT', () => {
  log.info('shutting down')
  client.destroy()
  process.exit(0)
})

log.info('starting Ascend alert bot…')
client.login(config.discord.token).catch(e => {
  log.error(`login failed: ${e.message}`)
  process.exit(1)
})
