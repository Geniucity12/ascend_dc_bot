export const CHAIN_ID = 99901
export const DEPLOY_BLOCK = 422319n

// ─── Contracts (Elysium mainnet, chain 99901) ───────────────────────────────
export const ADDR = {
  launchpad: '0xe0dEF4221b9840a610D4e7d55812a79A6431a8eC',
  escrowFactory: '0x63f6a8A8d0257c0363251a50cdE8A8b1046e4d19',
  seatFactory: '0xBDB8d64452191041C4dAA3AD0f64bE4380FEA0b1',
  poolManager: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',
  stateView: '0x27eD73aE0652fdCf71d6793412A7525f32bE9dfE',
  universalRouter: '0x1B341FDD55d56F8E08409A2C25DDFad93Eb03C1a',
  v4Quoter: '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5',
  positionManager: '0x1d1C51b9d07fD27d36412A2b66CC23D19Eb3E518',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  ctoRegistry: '0x8C26412796e7A759916D8EE0c2D91F2976e96dA8',
  burnSink: '0x9F0b0e3B362937b07Cd1E869b50687961e0c7741',
}

// ─── Pair assets ────────────────────────────────────────────────────────────
// Keys are lowercased. `startTick` is each asset's opening tick as read from
// quoteConfig() on chain — the most reliable sanity check on a computed price.
export const QUOTES = {
  '0xba876237b0f021a6c6d852d6c26e107997cc5e81': {
    symbol: 'HYPE',
    decimals: 18,
    startTick: -168600,
    minTrade: 0.5,
  },
  '0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65': {
    symbol: 'USDC',
    decimals: 6,
    startTick: -400600,
    minTrade: 1,
  },
  '0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0': {
    symbol: 'KNTQ',
    decimals: 18,
    startTick: -117400,
    minTrade: 5,
  },
  '0x11265018bf2d5a99fb71efae73ad670203c1df44': {
    symbol: 'wNVDAx',
    decimals: 18,
    startTick: -174800,
    minTrade: 0.5,
  },
}

const FALLBACK_QUOTE = { symbol: 'QUOTE', decimals: 18, startTick: null, minTrade: 1 }

export function quoteInfo(address) {
  if (!address) return FALLBACK_QUOTE
  return QUOTES[address.toLowerCase()] ?? FALLBACK_QUOTE
}

// ─── Pool constants ─────────────────────────────────────────────────────────
export const POOL_FEE_FLAG = 0x800000 // dynamic-fee flag
export const POOL_TICK_SPACING = 200
export const LAUNCH_SUPPLY = 1_000_000_000 // 1e9 tokens
