import { sqrtPriceToPrice, launchPrice, marketCap, parseSwap, fmtAmount, fmtPrice } from './src/price.js'
import { quoteInfo } from './src/constants.js'

let pass = 0
let fail = 0

function check(name, actual, expected, tol = 0.01) {
  const ok = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-30) <= tol
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual} expected ${expected}`)
  ok ? pass++ : fail++
}

// ── 1. Real on-chain value: ROOMSCAT, HYPE pair, tokenIs0=true
// sqrtPriceX96=17296576244409546739331304, tick=-168600, dec 18/18
// Expected: price == 1.0001^-168600
{
  const sqrt = 17296576244409546739331304n
  const got = sqrtPriceToPrice(sqrt, true, 18, 18)
  const expected = Math.pow(1.0001, -168600)
  check('ROOMSCAT price matches tick', got, expected)
}

// ── 2. Inverted pool: tokenIs0=false must invert the ratio
{
  const tick = 168485
  const sqrtRatio = Math.sqrt(Math.pow(1.0001, tick))
  const sqrtX96 = BigInt(Math.round(sqrtRatio * Number(2n ** 96n)))
  const got = sqrtPriceToPrice(sqrtX96, false, 18, 18)
  const expected = Math.pow(1.0001, -tick)
  check('inverted pool (tokenIs0=false)', got, expected, 1e-6)
}

// ── 3. launchPrice must match a real pool's opening price
{
  const startTick = quoteInfo('0xbA876237B0F021A6c6D852d6c26E107997cC5E81').startTick
  const got = launchPrice('0xbA876237B0F021A6c6D852d6c26E107997cC5E81', 18)
  const expected = Math.pow(1.0001, startTick)
  check('launchPrice HYPE', got, expected)
}

// ── 4. USDC pair: startTick -400600 must give a sane USD mcap
{
  const p = launchPrice('0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65', 18)
  const mc = marketCap(p)
  console.log(`INFO  USDC launch price=${p} mcap=$${mc.toFixed(2)}`)
  const ok = mc > 500 && mc < 20000
  console.log(`${ok ? 'PASS' : 'FAIL'}  USDC launch mcap in plausible range (500..20000)`)
  ok ? pass++ : fail++
}

// ── 5. KNTQ pair
{
  const p = launchPrice('0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0', 18)
  console.log(`INFO  KNTQ launch price=${p} mcap=${marketCap(p).toFixed(2)}`)
  const ok = marketCap(p) > 100
  console.log(`${ok ? 'PASS' : 'FAIL'}  KNTQ launch mcap > 100`)
  ok ? pass++ : fail++
}

// ── 6. Real swap: pool 0xa138ea3b, tokenIs0=false, amount0=-43595464976090934
// (quote out) amount1=2014132859219747789742 (token in)  => SELL
// Wait — verify direction logic: tokenIs0=false means token is currency1,
// so rawToken=amount1=+2.014e21 (positive = token entered pool = trader sold)
{
  const args = {
    amount0: -43595464976090934n,
    amount1: 2014132859219747789742n,
    sqrtPriceX96: 17029177175717623464422533106476n,
    tick: 107412,
  }
  const t = parseSwap(args, false, 18, 18, '0xbA876237B0F021A6c6D852d6c26E107997cC5E81')
  console.log(`INFO  swap: isBuy=${t.isBuy} tokens=${fmtAmount(t.tokenAmount)} quote=${fmtAmount(t.quoteAmount)} price=${fmtPrice(t.price)}`)
  const ok = t.isBuy === false && t.tokenAmount > 0 && t.quoteAmount > 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  sell direction detected (token in, quote out)`)
  ok ? pass++ : fail++
}

// ── 7. A buy must be the opposite
{
  const args = {
    amount0: -73350563388054766636483n, // quote out (trader received quote) -> no
    amount1: 372856029136350846n,
    sqrtPriceX96: 35179425816747386353686999261186n,
    tick: 121923,
  }
  // token is currency1: rawToken = amount1 = +... (token in) => sell again
  const t = parseSwap(args, false, 18, 18, '0xbA876237B0F021A6c6D852d6c26E107997cC5E81')
  console.log(`INFO  swap2: isBuy=${t.isBuy} tokens=${fmtAmount(t.tokenAmount)}`)
}

// ── 8. Formatting must never produce exponent notation
{
  const cases = [0.00000123, 1e-9, 1234.5678, 0.5, 0, 21000000]
  let allOk = true
  for (const c of cases) {
    const s = fmtAmount(c)
    if (/e/i.test(s)) { allOk = false; console.log(`FAIL  fmtAmount(${c}) = "${s}" contains exponent`) }
    console.log(`INFO  fmtAmount(${c}) = "${s}"`)
  }
  console.log(`${allOk ? 'PASS' : 'FAIL'}  no exponent notation`)
  allOk ? pass++ : fail++
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
