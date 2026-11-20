/**
 * Pure formatting helpers for the Mistral usage sidebar section.
 *
 * Everything here is side-effect free and unit-testable without a DOM.
 * Erasable TS syntax only (node >= 22.18 strips types — no build step).
 */

export type BarLevel = "ok" | "warn" | "error"

export interface BarParts {
  /** Filled cells (`█`), length = floor(width * clampedPct / 100), capped at width. */
  filled: string
  /** Empty cells (`░`), so filled + empty always spans `width`. */
  empty: string
  /** The clamped percentage (0..100), or null when no percentage is known. */
  pct: number | null
}

/** Clamp a percentage into 0..100; non-finite input becomes 0. */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

/**
 * Render a usage bar of `width` cells. `pct` is clamped to 0..100 and the filled
 * cell count is floor(width * pct / 100). A null/undefined/non-finite pct renders
 * no filled cells and reports `pct: null` (caller should show raw text instead).
 */
export function renderBar(pct: number | null | undefined, width: number): BarParts {
  const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return { filled: "", empty: "░".repeat(w), pct: null }
  }
  const clamped = clampPct(pct)
  const cells = Math.min(w, Math.floor((w * clamped) / 100))
  return { filled: "█".repeat(cells), empty: "░".repeat(w - cells), pct: clamped }
}

/**
 * Color threshold for a usage bar (documented):
 * - `ok`    pct < 80
 * - `warn`  80 <= pct < 95
 * - `error` pct >= 95
 * - null / undefined / non-finite → `ok` (nothing to alarm about)
 */
export function barLevel(pct: number | null | undefined): BarLevel {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "ok"
  const c = clampPct(pct)
  if (c >= 95) return "error"
  if (c >= 80) return "warn"
  return "ok"
}

/** Alias of {@link barLevel} for callers that think in colors. */
export const barColor = barLevel

function trimTrailingZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s
}

/**
 * Format a number with k/M/B suffixes for large magnitudes.
 * null / undefined / non-finite → "—".
 * Examples: 0 → "0", 999 → "999", 1500 → "1.5k", 2_500_000 → "2.5M", 3e9 → "3B".
 */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 1e9) return sign + trimTrailingZero((abs / 1e9).toFixed(1)) + "B"
  if (abs >= 1e6) return sign + trimTrailingZero((abs / 1e6).toFixed(1)) + "M"
  if (abs >= 1e3) return sign + trimTrailingZero((abs / 1e3).toFixed(1)) + "k"
  return String(n)
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  JPY: "¥",
}

/**
 * Format a money amount. null / undefined / non-finite → "—".
 * Amounts >= 1000 use the k/M/B suffix form; smaller amounts get 2 decimals.
 * A null/empty currency omits the symbol entirely; known ISO codes map to a
 * symbol (EUR → "€12.50"); unknown codes are appended ("12.50 CHF").
 */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—"
  const num = Math.abs(amount) >= 1000 ? formatNumber(amount) : amount.toFixed(2)
  const cur = typeof currency === "string" && currency.trim() !== "" ? currency.trim().toUpperCase() : null
  if (!cur) return num
  const sym = CURRENCY_SYMBOLS[cur]
  return sym ? sym + num : `${num} ${cur}`
}

/** Alias of {@link formatMoney}. */
export const formatCurrency = formatMoney

/**
 * Format an ISO reset timestamp as YYYY-MM-DD (UTC). null/empty → "—";
 * unparseable input is returned verbatim so no information is lost.
 */
export function formatResetAt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 10)
}
