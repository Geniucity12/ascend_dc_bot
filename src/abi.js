import { parseAbi, parseAbiItem } from 'viem'

// ─── ABIs ───────────────────────────────────────────────────────────────────
export const launchpadAbi = parseAbi([
  'event Launched(bytes32 indexed poolId, address indexed token, address indexed creator, address quote, uint256 supplySeeded, uint256 devBuyTokens, uint24 fee, uint24 builderFee)',
  'event HookSwap(bytes32 indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint128 hookLPfeeAmount0, uint128 hookLPfeeAmount1)',
  'event QuoteConfigSet(address indexed quote, bool allowed, int24 startTick, uint128 maxClip)',
  'event PausedSet(bool paused)',
  'event BidFunded(bytes32 indexed poolId, address indexed funder, uint256 amount)',
  'event Filled(bytes32 indexed poolId, uint256 tokensIn, uint256 feeQuote, uint256 quotePaid)',
  'event TokensAccumulated(bytes32 indexed poolId, address indexed token, uint8 indexed source, uint256 amount)',
  'event Collected(bytes32 indexed poolId, uint256 tokenFees, uint256 quoteFees, uint256 tokensBurned, uint256 flywheelQuote)',
  'function currentFee(bytes32 poolId) view returns (uint24)',
  'function quoteConfig(address quote) view returns (bool allowed, int24 startTick, uint128 maxClip)',
  'function poolCreator(bytes32 poolId) view returns (address)',
  'function poolLaunchedAt(bytes32 poolId) view returns (uint40)',
  'function poolTokenIs0(bytes32 poolId) view returns (bool)',
  'function poolStartTick(bytes32 poolId) view returns (int24)',
  'function accruedFees(bytes32 poolId) view returns (uint256)',
  'function emaSqrtPrice(bytes32 poolId) view returns (uint160)',
  'function bidInventory(bytes32 poolId) view returns (uint256)',
  'function paused() view returns (bool)',
])

export const poolManagerAbi = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
])

export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
])

export const escrowFactoryAbi = parseAbi([
  'event EscrowLaunched(bytes32 indexed poolId, address indexed token, address indexed escrow, address recipient, bytes32 ruleSet, bool ctoOptIn)',
  'function escrowOf(bytes32 poolId) view returns (address)',
])

export const seatFactoryAbi = parseAbi([
  'event SeatDeployed(bytes32 indexed poolId, address indexed token, address indexed seat, uint8 kind)',
])

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
])

// ─── Event topics (every one verified against live chain data) ──────────────
export const TOPIC = {
  Launched: '0xe03d17b1e529b1975da402258d101e5f5240440f266b80122f331f42dea41bd7',
  HookSwap: '0x365f10e9e7ce45d7acfd986c42e0b666f8af282e440e6dafc78c1f2b2f786760',
  EscrowLaunched: '0x9f8b158a1c64e52870ee742661e36bb7f7c52b0cd660727a80af56907dab15ff',
  SeatDeployed: '0x4e1ef5839b30bf5a2d546d5dda69127767ec7321118b430e4d99956b46ea283c',
  PoolSwap: '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f',
  PoolInitialize: '0x1b3d7edb2e9c0b0e7c525b20aaaef0f5940d2ed71663c7d39266ecafac728859',
}

export const launchedEvent = parseAbiItem(
  'event Launched(bytes32 indexed poolId, address indexed token, address indexed creator, address quote, uint256 supplySeeded, uint256 devBuyTokens, uint24 fee, uint24 builderFee)',
)

export const poolSwapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
)

export const escrowLaunchedEvent = parseAbiItem(
  'event EscrowLaunched(bytes32 indexed poolId, address indexed token, address indexed escrow, address recipient, bytes32 ruleSet, bool ctoOptIn)',
)
