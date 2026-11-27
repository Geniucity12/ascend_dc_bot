import { log } from './logger.js'
import { watchersOf } from './db.js'

export async function sendAlertToGuilds(client, alertChannelIds, {
  embeds,
  components,
  poolToken,
  targetGuildIds,
}) {
  const targets = targetGuildIds ? new Set(targetGuildIds) : null
  const destinations = [...alertChannelIds.entries()]
    .filter(([guildId]) => !targets || targets.has(guildId))

  if (!destinations.length) {
    log.warn('alert dropped: no alerts channel configured')
    return
  }

  for (const [guildId, channelId] of destinations) {
    const channel = await client.channels.fetch(channelId).catch(() => null)
    if (!channel?.isTextBased() || channel.guildId !== guildId) {
      log.warn(`alert dropped: channel ${channelId} for guild ${guildId} not found or not text-based`)
      continue
    }

    try {
      await channel.send(components?.length ? { embeds, components } : { embeds })
    } catch (e) {
      log.error(`failed to send alert to guild ${guildId}: ${e.message}`)
      continue
    }

    if (poolToken) {
      const watchers = watchersOf(poolToken).filter(w => w.guild_id === guildId)
      if (watchers.length) {
        const mentions = watchers.map(w => `<@${w.user_id}>`).join(' ')
        await channel.send({ content: mentions, allowedMentions: { users: watchers.map(w => w.user_id) } })
          .catch(e => log.error(`failed to ping watchers in guild ${guildId}: ${e.message}`))
      }
    }
  }
}
