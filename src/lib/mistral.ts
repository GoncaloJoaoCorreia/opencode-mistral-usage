/**
 * Typed client for the Mistral La Plateforme usage APIs (base https://api.mistral.ai).
 *
 * Endpoints (per the published OpenAPI spec, verified 2026-11-20):
 * - GET /v1/billing/subscription  — standard key as `x-api-key` (DashboardContextAuth);
 *   the client also sends `Authorization: Bearer <standard key>` there.
 * - GET /v1/billing/budget        — same auth; may 403 without `see_org_inference_usage`.
 * - GET /v1/users/me/workspaces   — same auth; optional, only used for a label.
 *
 * The client NEVER throws: every failure degrades into a typed `UsageError`
 * ({ kind: "no-key" | "unauthorized" | "forbidden" | "http" | "network" | "parse" }).
 *
 * Erasable TS syntax only (no enums / namespaces / parameter properties) so
 * node >= 22.18 runs this file directly with type stripping — no build step.
 */

export type UsageErrorKind = "no-key" | "unauthorized" | "forbidden" | "http" | "network" | "parse"

export interface UsageError {
  kind: UsageErrorKind
  status?: number
  message: string
}

export interface MistralKeys {
  apiKey?: string
}

/** cli.json object-form plugin options can carry the key explicitly. */
export interface KeyOptions {
  apiKey?: string
}

export interface FetchUsageOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

// ---- section types -----------------------------------------------------------

export interface SubscriptionInfo {
  planName?: string
  paygEnabled?: boolean
  vibePaygEnabled?: boolean
  enterprise?: boolean
  error?: UsageError
}

export interface BudgetDetailInfo {
  usagePercentage?: number | null
  initialBudget?: number | null
  currency?: string | null
  resetAt?: string | null
  paygEnabled?: boolean
}

export interface BudgetInfo {
  apiBudget?: BudgetDetailInfo
  vibeBudget?: BudgetDetailInfo
  error?: UsageError
}

export interface UsageSnapshot {
  plan?: SubscriptionInfo
  budget?: BudgetInfo
  workspace?: string
  fetchedAt: string
  /** Top-level error — set when no standard key is available (no requests made). */
  error?: UsageError
}

// ---- key resolution ----------------------------------------------------------

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v
  }
  return undefined
}

/**
 * Resolve API keys from plugin options (cli.json object form) only. Environment
 * variables are deliberately NOT read — the standard key comes from the stored
 * OpenCode credential (see resolveStoredKey). Empty or whitespace-only strings
 * count as missing. Keys are never logged or persisted.
 */
export function resolveKeys(options: KeyOptions = {}): MistralKeys {
  return {
    apiKey: firstNonEmpty(options.apiKey),
  }
}

// ---- stored-credential fallback (OpenCode auth store) ---------------------------
//
// OpenCode's local API `GET /api/credential` (operationId `credential.list`) returns
// stored credentials — including key values — to local clients (same mechanism as
// `opencode auth export`). A TUI plugin can call it through `context.client`.
// The resolved key is used in memory only: never logged, never persisted.

/** Minimal structural shape of the generated client's credential resource.
 * `credential.list()` takes request options (not an input object) and resolves to
 * the entry array directly; the `{ data: [...] }` wrapper is accepted for tolerance. */
export interface CredentialClient {
  credential?: {
    list?: (requestOptions?: unknown) => Promise<unknown>
  }
}

/**
 * Pure picker: from `GET /api/credential` entries, return the ACTIVE `mistral`
 * key credential. Tolerates malformed entries; never throws; never logs the key.
 */
export function pickStoredMistralKey(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return undefined
  for (const e of entries) {
    if (typeof e !== "object" || e === null) continue
    const entry = e as Record<string, unknown>
    if (entry.integrationID !== "mistral" || entry.active !== true) continue
    const value = entry.value
    if (typeof value !== "object" || value === null) continue
    const v = value as Record<string, unknown>
    if (v.type === "key" && typeof v.key === "string" && v.key.trim() !== "") return v.key
  }
  return undefined
}

/**
 * Resolve the active stored Mistral API key via an OpenCode client
 * (`context.client`). Returns undefined on any failure — no client, the call
 * throws, or no matching entry. Never throws, never logs the key.
 */
export async function resolveStoredKey(client: CredentialClient | undefined): Promise<string | undefined> {
  try {
    const credential = client?.credential
    const list = credential?.list
    if (!credential || typeof list !== "function") return undefined
    const res = await list.call(credential)
    // The generated client resolves credential.list() to CredentialEntry[] directly;
    // accept a { data: [...] } wrapper too, in case the host shape changes.
    const entries = Array.isArray(res) ? res : (res as { data?: unknown } | null | undefined)?.data
    return pickStoredMistralKey(entries)
  } catch {
    return undefined
  }
}

// ---- defensive parsing helpers -------------------------------------------------

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what}: expected a JSON object, got ${Array.isArray(value) ? "array" : String(value)}`)
  }
  return value as Record<string, unknown>
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function optStringOrNull(v: unknown): string | null | undefined {
  return v === null ? null : optString(v)
}

function optNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function optNumberOrNull(v: unknown): number | null | undefined {
  return v === null ? null : optNumber(v)
}

function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined
}

// ---- pure parse functions (exported so tests need no fetch) --------------------

export function parseSubscription(json: unknown): SubscriptionInfo {
  const obj = asObject(json, "subscription")
  return {
    planName: optString(obj.plan_name),
    paygEnabled: optBool(obj.payg_enabled),
    vibePaygEnabled: optBool(obj.vibe_payg_enabled),
    enterprise: optBool(obj.enterprise),
  }
}

export function parseBudgetDetail(json: unknown): BudgetDetailInfo {
  const obj = asObject(json, "budget detail")
  return {
    usagePercentage: optNumberOrNull(obj.usage_percentage),
    initialBudget: optNumberOrNull(obj.initial_budget),
    currency: optStringOrNull(obj.currency),
    resetAt: optStringOrNull(obj.reset_at),
    paygEnabled: optBool(obj.payg_enabled),
  }
}

export function parseBudget(json: unknown): BudgetInfo {
  const obj = asObject(json, "budget")
  const info: BudgetInfo = {}
  if (obj.api_budget != null) info.apiBudget = parseBudgetDetail(obj.api_budget)
  if (obj.vibe_budget != null) info.vibeBudget = parseBudgetDetail(obj.vibe_budget)
  return info
}

export function parseWorkspaces(json: unknown): { workspace?: string; workspaceId?: string } {
  const obj = asObject(json, "workspaces")
  const list = obj.workspaces
  if (!Array.isArray(list) || list.length === 0) return {}
  const first = asObject(list[0], "workspaces.workspaces[0]")
  return {
    workspace: optString(first.name) ?? optString(first.id),
    workspaceId: optString(first.id),
  }
}

// ---- HTTP plumbing (never throws) ----------------------------------------------

export const DEFAULT_BASE_URL = "https://api.mistral.ai"
export const DEFAULT_TIMEOUT_MS = 10_000

type Result<T> = { ok: true; value: T } | { ok: false; error: UsageError }

interface RequestBase {
  fetchImpl: typeof fetch
  timeoutMs: number
  signal?: AbortSignal
}

function standardHeaders(apiKey: string): Record<string, string> {
  return {
    accept: "application/json",
    "x-api-key": apiKey,
    Authorization: `Bearer ${apiKey}`,
  }
}

async function requestJson(url: string, headers: Record<string, string>, base: RequestBase): Promise<Result<unknown>> {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (base.signal) {
    if (base.signal.aborted) controller.abort()
    else base.signal.addEventListener("abort", onExternalAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), base.timeoutMs)
  // Race the fetch against the abort signal: a fetchImpl that ignores the
  // signal must not hang the request (real fetch rejects on abort; mocks may not).
  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new DOMException("This operation was aborted", "AbortError"))
    if (controller.signal.aborted) onAbort()
    else controller.signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const res = await Promise.race([
      base.fetchImpl(url, { method: "GET", headers, signal: controller.signal }),
      abortPromise,
    ])
    if (!res.ok) {
      const status = res.status
      let message = `HTTP ${status}`
      try {
        const body = await res.text()
        if (body) message = `HTTP ${status}: ${body.slice(0, 200)}`
      } catch {
        // keep the short message
      }
      if (status === 401) return { ok: false, error: { kind: "unauthorized", status, message } }
      if (status === 403) return { ok: false, error: { kind: "forbidden", status, message } }
      return { ok: false, error: { kind: "http", status, message } }
    }
    try {
      return { ok: true, value: await res.json() }
    } catch (err) {
      return { ok: false, error: { kind: "parse", message: `malformed JSON: ${errMessage(err)}` } }
    }
  } catch (err) {
    const aborted = controller.signal.aborted
    return {
      ok: false,
      error: {
        kind: "network",
        message: aborted ? `request aborted or timed out: ${errMessage(err)}` : errMessage(err),
      },
    }
  } finally {
    clearTimeout(timer)
    base.signal?.removeEventListener("abort", onExternalAbort)
  }
}

function parseInto<T>(result: Result<unknown>, parse: (json: unknown) => T): { value?: T; error?: UsageError } {
  if (!result.ok) return { error: result.error }
  try {
    return { value: parse(result.value) }
  } catch (err) {
    return { error: { kind: "parse", message: errMessage(err) } }
  }
}

// ---- public entry point ----------------------------------------------------------

async function fetchUsageInner(keys: MistralKeys, options: FetchUsageOptions): Promise<UsageSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const base: RequestBase = { fetchImpl, timeoutMs, signal: options.signal }
  const fetchedAt = new Date().toISOString()

  const apiKey = keys.apiKey?.trim() ? keys.apiKey : undefined
  if (!apiKey) {
    // No standard key → no requests at all, typed degradation.
    return {
      fetchedAt,
      error: { kind: "no-key", message: "no Mistral API key: connect Mistral via /connect (stored credential) or pass options.apiKey" },
    }
  }

  const snapshot: UsageSnapshot = { fetchedAt }

  // 1) subscription plan — standard key as x-api-key AND Bearer
  {
    const r = await requestJson(`${baseUrl}/v1/billing/subscription`, standardHeaders(apiKey), base)
    if (!r.ok) snapshot.plan = { error: r.error }
    else {
      const p = parseInto(r, parseSubscription)
      snapshot.plan = p.error ? { error: p.error } : p.value ?? {}
    }
  }

  // 2) budget (may 403 without see_org_inference_usage — section error only)
  {
    const r = await requestJson(`${baseUrl}/v1/billing/budget`, standardHeaders(apiKey), base)
    if (!r.ok) snapshot.budget = { error: r.error }
    else {
      const p = parseInto(r, parseBudget)
      snapshot.budget = p.error ? { error: p.error } : p.value ?? {}
    }
  }

  // 3) workspaces — optional label only, failures are ignored
  {
    const r = await requestJson(`${baseUrl}/v1/users/me/workspaces`, standardHeaders(apiKey), base)
    if (r.ok) {
      try {
        const parsed = parseWorkspaces(r.value)
        if (parsed.workspace) snapshot.workspace = parsed.workspace
      } catch {
        // label is optional — a malformed body here must not fail the snapshot
      }
    }
  }

  return snapshot
}

export async function fetchUsage(keys: MistralKeys, options: FetchUsageOptions = {}): Promise<UsageSnapshot> {
  try {
    return await fetchUsageInner(keys, options)
  } catch (err) {
    // Absolute last resort — this function never throws.
    return { fetchedAt: new Date().toISOString(), error: { kind: "network", message: `unexpected error: ${errMessage(err)}` } }
  }
}
