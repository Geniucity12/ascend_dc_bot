import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js'
import { createServer } from 'node:http'

import { config } from './config.js'
import { log, setLevel } from './logger.js'
import { openDb } from './db.js'
import { commands } from './commands.js'
import { handleCommand } from './handlers.js'
import { reconcile, startLive } from './watcher.js'
import { pruneSeen, watchersOf } from './db.js'
import { infoEmbed } from './render.js'
import { quoteInfo } from './constants.js'
import { fmtAmount, fmtPrice, marketCap } from './price.js'
import { getHead } from './chain.js'
import { startDigest } from './digest.js'

setLevel(config.logLevel)

openDb(config.dbPath)

const state = {
  alertChannelId: config.discord.alertChannelId || null,
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
})

/**
 * Sends an alert to the configured channel, then pings anyone watching that
 * token. Watch pings are separate messages so the embed stays clean.
 */
async function sendAlert({ embeds, poolToken }) {
  const channelId = state.alertChannelId
  if (!channelId) {
    log.warn('alert dropped: no alerts channel configured')
    return
  }

  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel?.isTextBased()) {
    log.warn(`alert dropped: channel ${channelId} not found or not text-based`)
    return
  }

  try {
    await channel.send({ embeds })
  } catch (e) {
    log.error(`failed to send alert: ${e.message}`)
    return
  }

  if (poolToken) {
    const watchers = watchersOf(poolToken)
    if (watchers.length) {
      const mentions = watchers.map(w => `<@${w.user_id}>`).join(' ')
      await channel.send({ content: mentions, allowedMentions: { users: watchers.map(w => w.user_id) } })
        .catch(() => {})
    }
  }
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

  // Tell the user which channels are available if none is configured.
  if (!state.alertChannelId) {
    const guild = guilds[0]
    const channels = guild.channels.cache
      .filter(ch => ch.isTextBased() && ch.permissionsFor?.(c.user)?.has('SendMessages'))
      .map(ch => `• #${ch.name} — \`${ch.id}\``)
      .slice(0, 20)
      .join('\n')

    log.warn('ALERT_CHANNEL_ID is not set. Pick one and add it to .env:')
    log.warn(`\n${channels}\n`)
  }

  c.user.setPresence({
    activities: [{ name: 'Ascend launches', type: ActivityType.Watching }],
    status: 'online',
  })

  // Catch up on anything missed while offline, then go live.
  await reconcile(sendAlert)
  startLive(sendAlert)
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
    log.info(`heartbeat · head=${head ?? '?'} · channel=${state.alertChannelId ?? 'none'}`)
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
