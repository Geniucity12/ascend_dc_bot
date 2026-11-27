import { EmbedBuilder } from 'discord.js'
import { config } from './config.js'
import { quoteInfo } from './constants.js'
import { fmtAmount, fmtPrice, marketCap, pctChange } from './price.js'
import { resolveUri } from './metadata.js'
import {
  getPoolByToken,
  addWatch,
  removeWatch,
  listWatches,
  recentPools,
  topPools,
  setGuildAlertChannelId,
  poolCount,
  historyFloor,
} from './db.js'
import { getHead } from './chain.js'
import { infoEmbed, errorEmbed, short } from './render.js'

const tokenLink = (a) => `${config.explorerUrl}/token/${a}`
const addrLink = (a) => `${config.explorerUrl}/address/${a}`

function poolEmbed(pool) {
  const q = quoteInfo(pool.quote)
  const price = pool.lastPrice ?? pool.firstPrice ?? 0
  const mcap = marketCap(price)
  const change = pctChange(pool.firstPrice, price)
  const image = resolveUri(pool.imageUri)

  const e = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle(`${pool.name ?? 'Unknown'} · ${pool.symbol ?? '?'}`)
    .setURL(tokenLink(pool.token))
    .setTimestamp(new Date())

  if (image) e.setThumbnail(image)

  const rows = [
    `**Price** ${fmtPrice(price)} ${q.symbol}`,
    `**Market cap** ${fmtAmount(mcap)} ${q.symbol}`,
    `**Fee** ${pool.feePips != null ? `${(pool.feePips / 10000).toFixed(2)}%` : '–'}`,
    `**Trades** ${pool.tradeCount ?? 0}`,
    `**Volume** ${fmtAmount(pool.volumeQuote ?? 0)} ${q.symbol}`,
  ]
  if (change != null) {
    rows.push(`**Since launch** ${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`)
  }
  e.setDescription(rows.join('\n'))

  e.addFields(
    { name: 'Token', value: `[${short(pool.token)}](${tokenLink(pool.token)})`, inline: true },
    { name: 'Creator', value: `[${short(pool.creator)}](${addrLink(pool.creator)})`, inline: true },
    { name: 'Pool', value: `\`${pool.poolId.slice(0, 10)}…\``, inline: true },
  )

  return e
}


const invalidToken = () => errorEmbed('That is not a valid token address.')

export async function handleCommand(interaction, state) {
  const { commandName } = interaction

  try {
    if (commandName === 'watch') {
      const token = interaction.options.getString('token', true).trim()
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) {
        return interaction.reply({ embeds: [invalidToken()], ephemeral: true })
      }
      const pool = getPoolByToken(token)
      // A token may not have a pool record yet: it may not have launched, or
      // it launched before this bot started indexing. Watching it anyway is
      // fine — the watch row is keyed by token and sendAlert() looks watchers
      // up by token, so the ping fires the moment the pool appears.
      addWatch(interaction.guildId, interaction.user.id, token, interaction.channelId)
      const label = pool?.symbol ? `**${pool.symbol}**` : `\`${short(token)}\``
      return interaction.reply({
        embeds: [infoEmbed(
          'Watching',
          pool
            ? `You will be pinged on launches and trades for ${label}.`
            : `${label} is not indexed yet. You will be pinged the moment it launches.`,
        )],
        ephemeral: true,
      })
    }

    if (commandName === 'unwatch') {
      const token = interaction.options.getString('token', true).trim()
      const removed = removeWatch(interaction.user.id, token)
      return interaction.reply({
        embeds: [removed
          ? infoEmbed('Removed', 'You are no longer watching that coin.')
          : errorEmbed('You were not watching that coin.')],
        ephemeral: true,
      })
    }

    if (commandName === 'watchlist') {
      const rows = listWatches(interaction.user.id)
      if (!rows.length) {
        return interaction.reply({
          embeds: [infoEmbed('Watchlist', 'Empty. Use `/watch <token>` to add a coin.')],
          ephemeral: true,
        })
      }
      const lines = rows.map(r => {
        const p = getPoolByToken(r.token)
        return p
          ? `• **${p.symbol ?? short(r.token)}** — ${fmtPrice(p.lastPrice ?? p.firstPrice ?? 0)} ${quoteInfo(p.quote).symbol}`
          : `• \`${short(r.token)}\` — unknown pool`
      })
      return interaction.reply({
        embeds: [infoEmbed(`Watching ${rows.length} coin(s)`, lines.join('\n'))],
        ephemeral: true,
      })
    }

    if (commandName === 'pool') {
      const token = interaction.options.getString('token', true).trim()
      const pool = getPoolByToken(token)
      if (!pool) {
        return interaction.reply({ embeds: [errorEmbed('No Ascend pool found for that token.')], ephemeral: true })
      }
      return interaction.reply({ embeds: [poolEmbed(pool)] })
    }

    if (commandName === 'recent') {
      const pools = recentPools(10)
      if (!pools.length) return interaction.reply({ embeds: [infoEmbed('Recent launches', 'Nothing indexed yet.')] })
      const lines = pools.map((p, i) => {
        const q = quoteInfo(p.quote)
        const blk = p.launchBlock != null ? ` · ${p.launchBlock}` : ''
      return `${i + 1}. **${p.symbol ?? '?'}** — ${fmtAmount(marketCap(p.lastPrice ?? p.firstPrice ?? 0))} ${q.symbol} · [token](${tokenLink(p.token)})${blk}`
      })
      return interaction.reply({ embeds: [infoEmbed('Recent launches', lines.join('\n'))] })
    }

    if (commandName === 'top') {
      const pools = topPools(10)
      if (!pools.length) return interaction.reply({ embeds: [infoEmbed('Top pools', 'Nothing indexed yet.')] })
      const lines = pools.map((p, i) => {
        const q = quoteInfo(p.quote)
        return `${i + 1}. **${p.symbol ?? '?'}** — ${fmtAmount(p.volumeQuote ?? 0)} ${q.symbol} vol · ${p.tradeCount ?? 0} trades`
      })
      return interaction.reply({ embeds: [infoEmbed('Top pools by volume', lines.join('\n'))] })
    }

    if (commandName === 'help') {
      const digest = Math.round(config.alerts.digestSeconds / 60)
      return interaction.reply({
        embeds: [infoEmbed(
          'Ascend Alerts',
          [
            'Reads the Ascend launchpad straight off the chain and posts to this server. Two kinds of alert:',
            '',
            '**Launches** post the moment a coin is created — price, market cap, creator, token link.',
            '',
            `**Trades** are grouped into one top-10 USD-volume report every ${digest} min. USD values are estimates. Coins you watch can also get their own update. A pool needs ${config.alerts.digestMinTrades} trades or ${config.alerts.digestMinVolume} cumulative volume to qualify; trades under ${config.alerts.minTradeQuote} are ignored as dust.`,
            '',
            '**Commands**',
            '`/watch <token>` — get pinged on that coin’s launches and trades',
            '`/unwatch <token>` — stop those pings',
            '`/watchlist` — see what you are watching',
            '`/pool <token>` — stats for one coin',
            '`/recent` — latest launches',
            '`/top` — busiest coins by volume',
            '`/status` — bot and chain health',
            '`/subscribe #channel` — where alerts go (admin)',
            '',
            '`/watch` works on a coin that has not launched yet — you will be pinged when it does.',
          ].join('\n'),
        )],
        ephemeral: true,
      })
    }


    if (commandName === 'status') {
      const head = await getHead().catch(() => null)
      const lines = [
        '**Chain** Elysium (99901)',
        `**Head block** ${head ?? 'unreachable'}`,
 `**Indexed back to** ${historyFloor() ?? 'unknown'} (backfill low-water)`,
 `**Pools stored** ${poolCount()}`,
        `**Alerts channel** ${state.alertChannelIds.get(interaction.guildId) ? `<#${state.alertChannelIds.get(interaction.guildId)}>` : 'not set in this server'}`,
        `**Launches** ${config.alerts.launches ? 'on' : 'off'} · **Trades** ${config.alerts.trades ? 'on' : 'off'}`,
        `**Rate cap** ${config.alerts.maxAlertsPerMinute}/min · cooldown ${config.alerts.poolCooldownSeconds}s`,
      ]
      return interaction.reply({ embeds: [infoEmbed('Status', lines.join('\n'))], ephemeral: true })
    }

    if (commandName === 'subscribe') {
      if (!interaction.guildId) {
        return interaction.reply({ embeds: [errorEmbed('Subscribe must be used in a server.')], ephemeral: true })
      }
      const channel = interaction.options.getChannel('channel', true)
      state.alertChannelIds.set(interaction.guildId, channel.id)
      setGuildAlertChannelId(interaction.guildId, channel.id)
      return interaction.reply({
        embeds: [infoEmbed('Subscribed', `Live alerts will post in <#${channel.id}>.`)],
        ephemeral: true,
      })
    }

    if (commandName === 'unsubscribe') {
      if (!interaction.guildId) {
        return interaction.reply({ embeds: [errorEmbed('Unsubscribe must be used in a server.')], ephemeral: true })
      }
      state.alertChannelIds.delete(interaction.guildId)
      setGuildAlertChannelId(interaction.guildId, null)
      return interaction.reply({ embeds: [infoEmbed('Unsubscribed', 'Live alerts are off.')], ephemeral: true })
    }
  } catch (e) {
    console.error(`command ${commandName} failed:`, e)
    const payload = { embeds: [errorEmbed(`Something went wrong: ${e.message}`)], ephemeral: true }
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {})
    else await interaction.reply(payload).catch(() => {})
  }
}
