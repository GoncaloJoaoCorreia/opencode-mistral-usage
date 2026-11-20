// Unit tests for src/lib/format.ts — pure helpers, no fetch, no DOM.
// Run: node --test test/   (node >= 22.18 strips types; erasable TS only)
// @ts-ignore -- node type stripping requires the explicit .ts extension (TS5097 without allowImportingTsExtensions)
import { barColor, barLevel, clampPct, formatCurrency, formatMoney, formatNumber, formatResetAt, formatResetIn, renderBar } from "../src/lib/format.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

test("renderBar fills floor(width*pct/100) cells with █ and pads with ░", () => {
  assert.deepEqual(renderBar(50, 10), { filled: "█████", empty: "░░░░░", pct: 50 })
  assert.deepEqual(renderBar(75, 10), { filled: "███████", empty: "░░░", pct: 75 }) // floor(7.5) = 7
  assert.deepEqual(renderBar(33, 10), { filled: "███", empty: "░░░░░░░", pct: 33 }) // floor(3.3) = 3
  assert.deepEqual(renderBar(1, 100), { filled: "█", empty: "░".repeat(99), pct: 1 })
})

test("renderBar edge cases: 0, 100, over-100, negative, width 0, null/undefined", () => {
  assert.deepEqual(renderBar(0, 10), { filled: "", empty: "░░░░░░░░░░", pct: 0 })
  assert.deepEqual(renderBar(100, 10), { filled: "██████████", empty: "", pct: 100 })
  assert.deepEqual(renderBar(250, 10), { filled: "██████████", empty: "", pct: 100 }, "clamped to 100")
  assert.deepEqual(renderBar(-20, 8), { filled: "", empty: "░░░░░░░░", pct: 0 }, "clamped to 0")
  assert.deepEqual(renderBar(50, 0), { filled: "", empty: "", pct: 50 })
  assert.deepEqual(renderBar(null, 10), { filled: "", empty: "░░░░░░░░░░", pct: null })
  assert.deepEqual(renderBar(undefined, 4), { filled: "", empty: "░░░░", pct: null })
  assert.deepEqual(renderBar(Number.NaN, 4), { filled: "", empty: "░░░░", pct: null })
  // filled + empty always spans width
  for (const pct of [0, 13, 50, 79, 80, 95, 100, 140]) {
    const bar = renderBar(pct, 20)
    assert.equal(bar.filled.length + bar.empty.length, 20)
    assert.equal(bar.filled.length, Math.floor((20 * Math.min(100, Math.max(0, pct))) / 100))
  }
})

test("clampPct clamps to 0..100 and maps non-finite to 0", () => {
  assert.equal(clampPct(50), 50)
  assert.equal(clampPct(0), 0)
  assert.equal(clampPct(100), 100)
  assert.equal(clampPct(101), 100)
  assert.equal(clampPct(-1), 0)
  assert.equal(clampPct(Number.NaN), 0)
  assert.equal(clampPct(Number.POSITIVE_INFINITY), 0)
})

test("barLevel thresholds: ok < 80, warn 80..<95, error >= 95, null → ok", () => {
  assert.equal(barLevel(0), "ok")
  assert.equal(barLevel(79.9), "ok")
  assert.equal(barLevel(80), "warn")
  assert.equal(barLevel(94.9), "warn")
  assert.equal(barLevel(95), "error")
  assert.equal(barLevel(100), "error")
  assert.equal(barLevel(200), "error", "clamped first")
  assert.equal(barLevel(null), "ok")
  assert.equal(barLevel(undefined), "ok")
  assert.equal(barColor, barLevel, "barColor is an alias of barLevel")
})

test("formatNumber: null/NaN → —, small plain, k/M/B suffixes, negatives", () => {
  assert.equal(formatNumber(null), "—")
  assert.equal(formatNumber(undefined), "—")
  assert.equal(formatNumber(Number.NaN), "—")
  assert.equal(formatNumber(0), "0")
  assert.equal(formatNumber(999), "999")
  assert.equal(formatNumber(12.5), "12.5")
  assert.equal(formatNumber(1000), "1k")
  assert.equal(formatNumber(1500), "1.5k")
  assert.equal(formatNumber(2_500_000), "2.5M")
  assert.equal(formatNumber(3e9), "3B")
  assert.equal(formatNumber(1.2e12), "1200B", "beyond B keeps the B suffix")
  assert.equal(formatNumber(-1500), "-1.5k")
})

test("formatMoney / formatCurrency: null amount → —, symbols, code fallback, no currency", () => {
  assert.equal(formatMoney(null, "EUR"), "—")
  assert.equal(formatMoney(undefined), "—")
  assert.equal(formatMoney(Number.NaN, "USD"), "—")
  assert.equal(formatMoney(12.5, "EUR"), "€12.50")
  assert.equal(formatMoney(10, "USD"), "$10.00")
  assert.equal(formatMoney(5, "gbp"), "£5.00", "currency code is case-insensitive")
  assert.equal(formatMoney(12.5, null), "12.50", "null currency omits the symbol")
  assert.equal(formatMoney(12.5, ""), "12.50")
  assert.equal(formatMoney(42, "CHF"), "42.00 CHF", "unknown code is appended")
  assert.equal(formatMoney(1500, "EUR"), "€1.5k", "large amounts use suffix form")
  assert.equal(formatCurrency(12.5, "EUR"), formatMoney(12.5, "EUR"), "formatCurrency is an alias")
})

test("formatResetAt: ISO → YYYY-MM-DD (UTC), null → —, garbage passes through", () => {
  assert.equal(formatResetAt("2026-12-01T00:00:00.000Z"), "2026-12-01")
  assert.equal(formatResetAt("2026-12-01"), "2026-12-01")
  assert.equal(formatResetAt(null), "—")
  assert.equal(formatResetAt(undefined), "—")
  assert.equal(formatResetAt(""), "—")
  assert.equal(formatResetAt("not-a-date"), "not-a-date")
})

test("formatResetIn: picks the appropriate unit and reads 'x <unit> to reset'", () => {
  const now = new Date("2026-11-20T12:00:00.000Z")
  // 11 days ahead → days
  assert.equal(formatResetIn("2026-12-01T12:00:00.000Z", now), "11 days to reset")
  // exactly 1 day ahead → singular
  assert.equal(formatResetIn("2026-11-21T12:00:00.000Z", now), "1 day to reset")
  // 12 hours ahead → hours
  assert.equal(formatResetIn("2026-11-21T00:00:00.000Z", now), "12 hours to reset")
  // 36 hours ahead → 1 day (days branch starts at 24 h)
  assert.equal(formatResetIn("2026-11-22T00:00:00.000Z", now), "1 day to reset")
  // exactly 1 hour ahead → singular
  assert.equal(formatResetIn("2026-11-20T13:00:00.000Z", now), "1 hour to reset")
  // 45 minutes ahead → minutes
  assert.equal(formatResetIn("2026-11-20T12:45:00.000Z", now), "45 minutes to reset")
  // 1 minute ahead → singular
  assert.equal(formatResetIn("2026-11-20T12:01:00.000Z", now), "1 minute to reset")
  // under a minute → less than a minute
  assert.equal(formatResetIn("2026-11-20T12:00:30.000Z", now), "less than a minute to reset")
  // past → reset due
  assert.equal(formatResetIn("2026-11-19T12:00:00.000Z", now), "reset due")
  assert.equal(formatResetIn("2026-11-20T12:00:00.000Z", now), "reset due")
  // null / garbage → null (caller hides the hint)
  assert.equal(formatResetIn(null, now), null)
  assert.equal(formatResetIn(undefined, now), null)
  assert.equal(formatResetIn("", now), null)
  assert.equal(formatResetIn("not-a-date", now), null)
})
