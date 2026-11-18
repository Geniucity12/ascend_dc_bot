import { createPublicClient, http, webSocket, decodeEventLog } from 'viem'
import { config } from './config.js'
import { log } from './logger.js'
import { ADDR, quoteInfo } from './constants.js'
import {
  TOPIC, launchpadAbi, poolManagerAbi, escrowFactoryAbi, erc20Abi, stateViewAbi,
  launchedEvent, poolSwapEvent, escrowLaunchedEvent,
} from './abi.js'

// Two clients on purpose:
//  - `ws`   : live log subscription (Alchemy WebSocket)
//  - `http` : eth_call reads (Alchemy HTTP)
//  - `pub`  : wide eth_getLogs backfill (public RPC; Alchemy free tier caps
//             getLogs at a 10-block range, the public node does not)
export const ws = createPublicClient({ transport: webSocket(config.chain.wsUrl) })
export const httpClient = createPublicClient({ transport: http(config.chain.httpUrl) })
export const pub = createPublicClient({ transport: http(config.chain.publicRpcUrl) })

export async function getHead() {
  return pub.getBlockNumber()
}

/**
 * Fetch logs over a wide range from the public RPC, chunked so a single
 * oversized request cannot fail the whole backfill.
 */
export async function getLogsChunked({ address, fromBlock, toBlock, chunk = 10_000n }) {
  const out = []
  let start = fromBlock
  while (start <= toBlock) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n
    try {
      const logs = await pub.getLogs({ address, fromBlock: start, toBlock: end })
      out.push(...logs)
    } catch (e) {
      const msg = e.shortMessage ?? e.message
      log.warn(`getLogs ${start}-${end} failed: ${msg}`)
      // The public RPC rejects ranges that are too wide *or* too log-dense.
      // Halve and retry, down to a floor, then give up on this window.
      if (chunk > 1_000n) {
        const half = chunk / 2n
        const retry = await getLogsChunked({ address, fromBlock: start, toBlock: end, chunk: half })
        out.push(...retry)
      } else {
        log.error(`getLogs ${start}-${end} permanently failed; skipping window`)
      }
    }
    start = end + 1n
  }
  return out
}

/** Decode a raw log into { eventName, args } or null if unrecognised. */
export function decodeLog(rawLog) {
  const topic0 = rawLog.topics?.[0]
  if (!topic0) return null

  try {
    if (topic0 === TOPIC.Launched) {
      return { eventName: 'Launched', args: decodeEventLog({ abi: launchpadAbi, eventName: 'Launched', data: rawLog.data, topics: rawLog.topics }).args }
    }
    if (topic0 === TOPIC.PoolSwap) {
      return { eventName: 'Swap', args: decodeEventLog({ abi: poolManagerAbi, eventName: 'Swap', data: rawLog.data, topics: rawLog.topics }).args }
    }
    if (topic0 === TOPIC.EscrowLaunched) {
      return { eventName: 'EscrowLaunched', args: decodeEventLog({ abi: escrowFactoryAbi, eventName: 'EscrowLaunched', data: rawLog.data, topics: rawLog.topics }).args }
    }
  } catch (e) {
    log.debug(`decode failed for ${topic0}: ${e.message}`)
  }
  return null
}

/** Read a token's on-chain identity. Falls back gracefully on odd tokens. */
export async function readToken(token) {
  const [name, symbol, decimals] = await Promise.all([
    httpClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => null),
    httpClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
    httpClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ])
  return { name, symbol, decimals: Number(decimals) }
}

/** Current pool price from StateView. */
export async function readSlot0(poolId) {
  const [sqrtPriceX96, tick] = await httpClient.readContract({
    address: ADDR.stateView,
    abi: stateViewAbi,
    functionName: 'getSlot0',
    args: [poolId],
  })
  return { sqrtPriceX96, tick: Number(tick) }
}

/**
 * A pool's token is currency0 when the token address sorts below the quote
 * address. This is pure address ordering — no RPC call needed.
 */
export function tokenIsCurrency0(token, quote) {
  return token.toLowerCase() < quote.toLowerCase()
}

export { launchedEvent, poolSwapEvent, escrowLaunchedEvent, quoteInfo }
