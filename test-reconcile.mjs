import { reconcile } from './src/watcher.js'
import { openDb, setCursor, getCursor, recentPools, getPoolByToken } from './src/db.js'
import { config } from './src/config.js'
import { log } from './src/logger.js'

openDb(config.dbPath)

const missedPool = '0x9e34Ad3ecb2f8A164C9eA892eFA84C4502C7Db4c'
const missedBlock = 7792046n

console.log(`before: cursor=${getCursor('main', null)}`)
console.log(`before: have missed pool? ${getPoolByToken(missedPool) ? 'yes' : 'NO'}`)

// Rewind the cursor to just before the launch that was skipped, then let
// reconcile walk the range exactly as it would after a long sleep.
setCursor('main', missedBlock - 5n)
console.log(`rewound cursor to ${missedBlock - 5n}`)

// Silent sender so this test posts nothing to Discord.
const send = async () => {}

await reconcile(send, { maxBlocksPerRun: 500_000n, coldStartBlocks: 0n })

const after = getPoolByToken(missedPool)
console.log(`\nafter: cursor=${getCursor('main', null)}`)
console.log(`after: recovered pool? ${after ? `YES — ${after.symbol} trades=${after.tradeCount}` : 'NO'}`)
console.log(`\nindexed pools: ${recentPools(50).length}`)
recentPools(50).forEach(p => console.log(`  ${p.symbol} block=${p.launchBlock} trades=${p.tradeCount}`))

process.exit(after ? 0 : 1)
