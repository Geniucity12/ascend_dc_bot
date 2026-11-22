import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'
import { config } from './config.js'
import { quoteInfo } from './constants.js'
import { fmtAmount, fmtPrice, marketCap, pctChange } from './price.js'
import { resolveUri } from './metadata.js'

const COLOR = {
  launch: 0x7c5cff,
  buy: 0x2ecc71,
  sell: 0xe74c3c,
  info: 0x5865f2,
  warn: 0xf1c40f,
  error: 0xed4245,
}

const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '–')

function txLink(hash) {
  return `${config.explorerUrl}/tx/${hash}`
}

function addrLink(addr) {
  return `${config.explorerUrl}/address/${addr}`
}

function tokenLink(addr) {
  return `${config.explorerUrl}/token/${addr}`
}

/**
 * Deep-link buttons. The point of an alert is not to inform, it is to get
 * someone to the trade screen in one click, so every launch carries the
 * buy link rather than making people copy a contract address out of an embed.
 *
 * Link-style buttons: no custom_id, no interaction handling, no permissions
 * beyond what embeds already need.
 */
export function quickBuyRows(pool) {
  if (!pool?.token) return []

  const ca = pool.token
  const buttons = []

  buttons.push(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Buy on Ascend')
      .setURL(`${config.ascendAppUrl}${config.ascendBuyPath}${ca}`),
  )

  if (config.fomoUrlTemplate) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Trade on Fomo')
        .setURL(config.fomoUrlTemplate.replace('{ca}', ca)),
    )
  }

  buttons.push(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('View Chart')
      .setURL(`${config.ascendAppUrl}${config.ascendChartPath}${ca}`),
  )

  // Discord caps a row at five buttons; three are used here, so one row is
  // always enough. Rows are still returned as an array because the callers
  // pass `components` straight through.
  return [new ActionRowBuilder().addComponents(buttons)]
}

/**
 * Launch alert. This is the post that makes people open the server, so it
 * carries everything a trader wants at a glance: name, ticker, pair, fee,
 * dev buy, opening mcap, and the creator.
 */
export function launchEmbed({ pool, metadata, txHash, blockNumber }) {
  const q = quoteInfo(pool.quote)
  const price = pool.firstPrice ?? 0
  const mcap = marketCap(price)
  const image = resolveUri(metadata?.imageUri ?? pool.imageUri)

  const e = new EmbedBuilder()
    .setColor(COLOR.launch)
    .setAuthor({ name: 'New launch on Ascend' })
    .setTitle(`${pool.name ?? metadata?.name ?? 'Unknown'} · ${pool.symbol ?? metadata?.symbol ?? '?'}`)
    .setURL(tokenLink(pool.token))
    .setTimestamp(new Date())

  if (image) e.setThumbnail(image)

  const lines = [
    `**Pair** ${q.symbol}`,
    `**Fee** ${pool.feePips != null ? `${(pool.feePips / 10000).toFixed(2)}%` : '–'}`,
    `**Open mcap** ${fmtAmount(mcap)} ${q.symbol}`,
    `**Dev buy** ${pool.devBuy && pool.devBuy !== '0' ? `${fmtAmount(Number(pool.devBuy) / 10 ** pool.tokenDecimals)} ${pool.symbol ?? ''}` : 'none'}`,
  ]
  e.setDescription(lines.join('\n'))

  const fields = [
    { name: 'Price', value: `${fmtPrice(price)} ${q.symbol}`, inline: true },
    { name: 'Creator', value: `[${short(pool.creator)}](${addrLink(pool.creator)})`, inline: true },
    { name: 'Token', value: `[${short(pool.token)}](${tokenLink(pool.token)})`, inline: true },
  ]

  if (metadata?.twitter || metadata?.website) {
    const links = []
    if (metadata.website) links.push(`[site](${metadata.website})`)
    if (metadata.twitter) links.push(`[x](https://x.com/${String(metadata.twitter).replace(/^@/, '')})`)
    if (metadata.telegram) links.push(`[tg](${metadata.telegram})`)
    fields.push({ name: 'Links', value: links.join(' · '), inline: false })
  }

  e.addFields(fields)

  if (metadata?.description) {
    const d = String(metadata.description).slice(0, 200)
    e.setFooter({ text: d })
  }

  if (txHash) {
    e.addFields({ name: 'Transaction', value: `[${short(txHash)}](${txLink(txHash)})`, inline: true })
  }

  return e
}

/** Launch embed plus its buy buttons, ready to hand to channel.send(). */
export function launchMessage({ pool, metadata, txHash }) {
  return {
    embeds: [launchEmbed({ pool, metadata, txHash })],
    components: quickBuyRows(pool),
    poolToken: pool.token,
  }
}

/**
 * Trade alert. Deliberately compact — a busy pool can trade every few
 * seconds and a wall of giant embeds is unreadable.
 */
export function tradeEmbed({ pool, trade, txHash }) {
  const q = quoteInfo(pool.quote)
  const sym = pool.symbol ?? '?'
  const isBuy = trade.isBuy

  const e = new EmbedBuilder()
    .setColor(isBuy ? COLOR.buy : COLOR.sell)
    .setAuthor({ name: `${isBuy ? 'Buy' : 'Sell'} · ${sym}` })
    .setDescription(
      [
        `**${fmtAmount(trade.tokenAmount)} ${sym}** for **${fmtAmount(trade.quoteAmount)} ${q.symbol}**`,
        `Price ${fmtPrice(trade.price)} ${q.symbol} · mcap ${fmtAmount(trade.mcap)} ${q.symbol}`,
      ].join('\n'),
    )
    .setTimestamp(new Date())

  const change = pctChange(pool.firstPrice, trade.price)
  if (change != null) {
    const arrow = change >= 0 ? '▲' : '▼'
    e.addFields({
      name: 'Since launch',
      value: `${arrow} ${Math.abs(change).toFixed(1)}%`,
      inline: true,
    })
  }

  e.addFields(
    { name: 'Trades', value: String((pool.tradeCount ?? 0) + 1), inline: true },
    { name: 'Volume', value: `${fmtAmount((pool.volumeQuote ?? 0) + trade.quoteAmount)} ${q.symbol}`, inline: true },
  )

  if (txHash) {
    e.setFooter({ text: `tx ${short(txHash)}` })
    e.setURL(txLink(txHash))
  }

  return e
}
/**
 * One embed summarising every trade on a pool within the digest window.
 * `b` comes from src/digest.js and carries buys/sells, volumes and the
 * largest print rather than a single trade.
 */
export function digestEmbed(b) {
 const q = quoteInfo(b.pool.quote)
 const sym = b.pool.symbol ?? '?'
 const total = b.buyVolume + b.sellVolume
 const prints = b.buys + b.sells
 const net = b.buyVolume - b.sellVolume
 const leaning = net > 0 ? 'buy' : net < 0 ? 'sell' : 'info'

 const e = new EmbedBuilder()
 .setColor(COLOR[leaning])
 .setAuthor({ name: `Trades · ${sym}` })
 .setDescription(
 [
 `**${prints}** trade${prints === 1 ? '' : 's'} · **${fmtAmount(total)} ${q.symbol}** volume`,
 `Price ${fmtPrice(b.pool.lastPrice)} ${q.symbol} · mcap ${fmtAmount(marketCap(b.pool.lastPrice))} ${q.symbol}`,
 ].join('\n'),
 )
 .setTimestamp(new Date())

 e.addFields(
 { name: 'Buys', value: `${b.buys} · ${fmtAmount(b.buyVolume)} ${q.symbol}`, inline: true },
 { name: 'Sells', value: `${b.sells} · ${fmtAmount(b.sellVolume)} ${q.symbol}`, inline: true },
 { name: 'Net', value: `${net > 0 ? '▲' : net < 0 ? '▼' : '·'} ${fmtAmount(Math.abs(net))} ${q.symbol}`, inline: true },
 )

 e.addFields({
 name: 'Largest',
 value: `${b.largest.isBuy ? 'Buy' : 'Sell'} · ${fmtAmount(b.largest.quoteAmount)} ${q.symbol}`,
 inline: true,
 })

 const change = pctChange(b.pool.firstPrice, b.pool.lastPrice)
 if (change != null) {
 e.addFields({
 name: 'Since launch',
 value: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`,
 inline: true,
 })
 }

 if (b.pool.token) {
 e.addFields({ name: 'Token', value: tokenLink(b.pool.token), inline: true })
 }

 return e
}

/** Trade digest plus its buy buttons. */
export function digestMessage(b) {
  return {
    embeds: [digestEmbed(b)],
    components: quickBuyRows(b.pool),
    poolToken: b.pool.token,
  }
}

export function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp(new Date())
}

export function errorEmbed(description) {
  return new EmbedBuilder().setColor(COLOR.error).setDescription(description)
}

export { COLOR, short }
