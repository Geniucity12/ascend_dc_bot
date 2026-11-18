import { QUOTES, LAUNCH_SUPPLY, quoteInfo } from './constants.js'

const Q96 = 2n ** 96n

/**
 * Convert a Uniswap v4 sqrtPriceX96 into a human price.
 *
 * In a v4 pool, `sqrtPriceX96` encodes price as (currency1 per currency0),
 * where currency0 is always the numerically lower address. Ascend sorts the
 * launched coin against its quote asset, so either ordering can occur.
 *
 * @param {bigint} sqrtPriceX96  raw sqrt price from getSlot0 / Swap event
 * @param {boolean} tokenIs0     true if the launched coin is currency0
 * @param {number} tokenDecimals decimals of the launched coin
 * @param {number} quoteDecimals decimals of the pair asset
 * @returns {number} quote asset units per 1 whole token
 */
export function sqrtPriceToPrice(sqrtPriceX96, tokenIs0, tokenDecimals, quoteDecimals) {
  if (!sqrtPriceX96 || sqrtPriceX96 === 0n) return 0

  // ratio = price = currency1_raw / currency0_raw
  // Use BigInt for the squaring to avoid float overflow, then divide.
  const numerator = sqrtPriceX96 * sqrtPriceX96
  const denominator = Q96 * Q96
  // Scale up before converting to Number so we keep precision on tiny prices.
  const SCALE = 10n ** 30n
  const scaled = (numerator * SCALE) / denominator
  const ratio = Number(scaled) / Number(SCALE)

  // ratio is quote_raw per token_raw when tokenIs0, else token_raw per quote_raw
  const quotePerTokenRaw = tokenIs0 ? ratio : 1 / ratio

  // Convert raw units to whole units:
  //   price = (quote_raw / token_raw) * 10^(tokenDecimals - quoteDecimals)
  return quotePerTokenRaw * 10 ** (tokenDecimals - quoteDecimals)
}

/**
 * Market cap in the quote asset, assuming the standard 1e9 launch supply.
 */
export function marketCap(price, supply = LAUNCH_SUPPLY) {
  return price * supply
}

/**
 * A pool's opening price, derived from the quote asset's start tick.
 * Ascend seeds every pool at quoteConfig(asset).startTick, so this is a
 * reliable baseline to compare a live price against.
 */
export function launchPrice(quoteAddress, tokenDecimals) {
  const q = quoteInfo(quoteAddress)
  if (q.startTick === null) return 0
  const raw = Math.pow(1.0001, q.startTick)
  return raw * 10 ** (tokenDecimals - q.decimals)
}

/**
 * Parse a PoolManager Swap event into a readable trade.
 *
 * `amount0` / `amount1` are the pool's deltas from the AMM's perspective:
 * negative means the currency left the pool (the trader received it),
 * positive means it entered (the trader paid it).
 *
 * A buy of the coin therefore shows a negative coin delta and a positive
 * quote delta. Both are returned in whole units.
 */
export function parseSwap(args, tokenIs0, tokenDecimals, quoteDecimals, quoteAddress) {
  const { amount0, amount1, sqrtPriceX96, tick } = args
  const rawToken = tokenIs0 ? amount0 : amount1
  const rawQuote = tokenIs0 ? amount1 : amount0

  // The trader received tokens (rawToken < 0) and paid quote (rawQuote > 0).
  const isBuy = rawToken < 0n

  const tokenAmount = Number(absBig(rawToken)) / 10 ** tokenDecimals
  const quoteAmount = Number(absBig(rawQuote)) / 10 ** quoteDecimals

  const price = sqrtPriceToPrice(sqrtPriceX96, tokenIs0, tokenDecimals, quoteDecimals)

  return {
    isBuy,
    tokenAmount,
    quoteAmount,
    price,
    mcap: marketCap(price),
    tick: Number(tick),
    quoteSymbol: quoteInfo(quoteAddress).symbol,
  }
}

function absBig(v) {
  return v < 0n ? -v : v
}

/**
 * Format a quote-denominated number for humans: 0.00000123 -> "0.00000123",
 * 1234.5 -> "1,234.5". Avoids scientific notation, which Discord embeds
 * render badly.
 */
export function fmtAmount(n, maxDecimals = 6) {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: Math.min(4, maxDecimals) })
  // small numbers: keep significant digits, never exponent notation
  const decimals = Math.min(18, Math.max(2, Math.ceil(-Math.log10(a)) + 3))
  return n.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
}

export function fmtPrice(n) {
  if (!Number.isFinite(n) || n === 0) return '–'
  return fmtAmount(n, 8)
}

/**
 * Percentage change between two prices, or null when a base is missing.
 */
export function pctChange(from, to) {
  if (!from || !Number.isFinite(from) || !Number.isFinite(to)) return null
  return ((to - from) / from) * 100
}
