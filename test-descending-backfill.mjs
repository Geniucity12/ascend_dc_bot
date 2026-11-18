// Verifies the descending crawl arithmetic: full coverage, contiguous windows,
// no overlap, correct termination at the floor.
const floor = 422319n
const head = 7950359n
const batch = 10000n

let to = head
const windows = []
let covered = 0n

while (to > floor) {
  const from = to - batch < floor ? floor : to - batch
  windows.push([from + 1n, to])
  covered += to - from
  to = from
  if (windows.length > 100000) throw new Error('runaway loop')
}

const expected = head - floor
let failed = 0
const check = (name, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`)
  if (!ok) failed++
}

check('covers every block', covered === expected, `${covered} vs ${expected}`)
check('terminates at floor', to === floor, to.toString())
check('batches reasonable', windows.length === 753, String(windows.length))

// Contiguity: each window must end exactly one below the previous start.
let contiguous = true
for (let i = 1; i < windows.length; i++) {
  if (windows[i][1] !== windows[i - 1][0] - 1n) { contiguous = false; break }
}
check('windows contiguous, no gaps', contiguous)

// The first window must reach head, so the newest history lands in batch 1.
check('first batch includes head', windows[0][1] === head)
// The last window must reach the deploy block.
check('last batch includes floor', windows.at(-1)[0] === floor + 1n, windows.at(-1)[0].toString())

console.log(`\n${failed === 0 ? 'ALL DESCENDING-CRAWL CHECKS PASSED' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
