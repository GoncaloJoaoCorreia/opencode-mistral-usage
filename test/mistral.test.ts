// Unit tests for src/lib/mistral.ts — node:test with a mocked fetchImpl.
// Run: node --test test/   (node >= 22.18 strips types; erasable TS only)
// @ts-ignore -- node type stripping requires the explicit .ts extension (TS5097 without allowImportingTsExtensions)
import { DEFAULT_BASE_URL, fetchUsage, parseBudget, parseSubscription, parseWorkspaces, pickStoredMistralKey, resolveKeys, resolveStoredKey } from "../src/lib/mistral.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

// ---- fixtures -----------------------------------------------------------------

const SUBSCRIPTION = { plan_name: "TEAM", payg_enabled: true, vibe_payg_enabled: false, enterprise: false }
const BUDGET = {
  api_budget: { usage_percentage: 42.5, initial_budget: 100, currency: "EUR", reset_at: "2026-12-01T00:00:00Z", payg_enabled: true },
  vibe_budget: { usage_percentage: null, initial_budget: null, currency: null, reset_at: null, payg_enabled: false },
}
const WORKSPACES = { workspaces: [{ id: "ws-1", name: "Acme Org" }] }

// ---- mock fetch ----------------------------------------------------------------

interface RecordedCall {
  url: string
  headers: Record<string, string>
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url)
    calls.push({ url: u, headers: { ...(init?.headers ?? {}) } })
    return handler(u)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function rawResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } })
}

function okAll(url: string): Response {
  if (url.includes("/v1/billing/subscription")) return jsonResponse(SUBSCRIPTION)
  if (url.includes("/v1/billing/budget")) return jsonResponse(BUDGET)
  if (url.includes("/v1/users/me/workspaces")) return jsonResponse(WORKSPACES)
  return jsonResponse({ message: "not found" }, 404)
}

// ---- tests ----------------------------------------------------------------------

test("billing/users endpoints get x-api-key AND Bearer standard key — exact URLs", async () => {
  const { fetchImpl, calls } = mockFetch(okAll)
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl, baseUrl: "https://api.test" })

  assert.equal(snap.error, undefined)
  assert.equal(calls.length, 3, "only the three standard-key endpoints are called")
  for (const c of calls) {
    assert.equal(c.headers["x-api-key"], "sk-test", `${c.url} must carry x-api-key`)
    assert.equal(c.headers.Authorization, "Bearer sk-test", `${c.url} must carry Bearer standard key`)
  }
  assert.ok(calls.some((c) => c.url === "https://api.test/v1/billing/subscription"))
  assert.ok(calls.some((c) => c.url === "https://api.test/v1/billing/budget"))
  assert.ok(calls.some((c) => c.url === "https://api.test/v1/users/me/workspaces"))
})

test("default base URL is https://api.mistral.ai", async () => {
  const { fetchImpl, calls } = mockFetch(okAll)
  await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.ok(calls.length > 0)
  for (const c of calls) assert.ok(c.url.startsWith(DEFAULT_BASE_URL + "/"), c.url)
})

test("no admin endpoints are ever called", async () => {
  const { fetchImpl, calls } = mockFetch(okAll)
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.equal(calls.filter((c) => c.url.includes("/v1/admin/")).length, 0)
  assert.equal(snap.plan?.planName, "TEAM")
})

test("missing or empty key → no-key error and zero requests", async () => {
  const a = mockFetch(okAll)
  const snapA = await fetchUsage({}, { fetchImpl: a.fetchImpl })
  assert.equal(snapA.error?.kind, "no-key")
  assert.equal(a.calls.length, 0)

  const b = mockFetch(okAll)
  const snapB = await fetchUsage({ apiKey: "   " }, { fetchImpl: b.fetchImpl })
  assert.equal(snapB.error?.kind, "no-key")
  assert.equal(b.calls.length, 0)
})

test("resolveKeys: plugin options only — env vars are NOT read; empty strings count as missing", () => {
  const savedKey = process.env.MISTRAL_API_KEY
  try {
    process.env.MISTRAL_API_KEY = "env-key"
    assert.equal(resolveKeys().apiKey, undefined, "MISTRAL_API_KEY env must be ignored")
    assert.equal(resolveKeys({ apiKey: "opt-key" }).apiKey, "opt-key")
    assert.equal(resolveKeys({ apiKey: "" }).apiKey, undefined, "empty option counts as missing")
    assert.equal(resolveKeys({ apiKey: "   " }).apiKey, undefined, "whitespace-only option counts as missing")
  } finally {
    if (savedKey === undefined) delete process.env.MISTRAL_API_KEY
    else process.env.MISTRAL_API_KEY = savedKey
  }
})

test("401 → unauthorized (with status); other sections still parsed", async () => {
  const { fetchImpl } = mockFetch((url) =>
    url.includes("/v1/billing/budget") ? jsonResponse(BUDGET) : jsonResponse({ message: "bad key" }, 401),
  )
  const snap = await fetchUsage({ apiKey: "sk-bad" }, { fetchImpl })
  assert.equal(snap.plan?.error?.kind, "unauthorized")
  assert.equal(snap.plan?.error?.status, 401)
  assert.equal(snap.budget?.apiBudget?.usagePercentage, 42.5, "good sections survive a failing one")
})

test("403 on budget (missing permission) → forbidden section error, plan still shown", async () => {
  const { fetchImpl } = mockFetch((url) => {
    if (url.includes("/v1/billing/budget")) return jsonResponse({ message: "missing permission" }, 403)
    return okAll(url)
  })
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.equal(snap.plan?.planName, "TEAM")
  assert.equal(snap.budget?.error?.kind, "forbidden")
  assert.equal(snap.budget?.error?.status, 403)
})

test("other HTTP statuses → http error with status", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ message: "server error" }, 500))
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.equal(snap.plan?.error?.kind, "http")
  assert.equal(snap.plan?.error?.status, 500)
})

test("network failure (fetch throws) → network error, never throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED")
  }) as unknown as typeof fetch
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.equal(snap.error, undefined, "no top-level error — per-section only")
  assert.equal(snap.plan?.error?.kind, "network")
  assert.match(snap.plan?.error?.message ?? "", /ECONNREFUSED/)
})

test("timeout via AbortController → network error", async () => {
  const fetchImpl = ((() => new Promise<Response>(() => {})) as unknown) as typeof fetch
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl, timeoutMs: 5 })
  assert.equal(snap.plan?.error?.kind, "network")
  assert.match(snap.plan?.error?.message ?? "", /abort|timed out/i)
})

test("malformed JSON body → parse error for that section only", async () => {
  const { fetchImpl } = mockFetch((url) =>
    url.includes("/v1/billing/subscription") ? rawResponse("{not json") : okAll(url),
  )
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.equal(snap.plan?.error?.kind, "parse")
  assert.equal(snap.budget?.apiBudget?.usagePercentage, 42.5)
  assert.equal(snap.workspace, "Acme Org")
})

test("pathological fetchImpl (returns garbage) → still never throws", async () => {
  const fetchImpl = (async () => null) as unknown as typeof fetch
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl })
  assert.ok(snap.plan?.error, "section error present")
  assert.ok(snap.fetchedAt.length > 0)
})

test("full snapshot aggregation: plan, budget, workspace label, fetchedAt", async () => {
  const { fetchImpl } = mockFetch(okAll)
  const snap = await fetchUsage({ apiKey: "sk-test" }, { fetchImpl, baseUrl: "https://api.test" })

  assert.equal(snap.error, undefined)
  assert.equal(snap.plan?.planName, "TEAM")
  assert.equal(snap.plan?.paygEnabled, true)
  assert.equal(snap.budget?.apiBudget?.usagePercentage, 42.5)
  assert.equal(snap.budget?.apiBudget?.currency, "EUR")
  assert.equal(snap.budget?.vibeBudget?.usagePercentage, null)
  assert.equal(snap.workspace, "Acme Org")
  assert.ok(!Number.isNaN(new Date(snap.fetchedAt).getTime()), "fetchedAt is an ISO timestamp")
})

test("pure parse functions on fixtures; invalid shapes throw", () => {
  const sub = parseSubscription(SUBSCRIPTION)
  assert.equal(sub.planName, "TEAM")
  assert.equal(sub.enterprise, false)
  assert.throws(() => parseSubscription(null))
  assert.throws(() => parseSubscription(42))
  assert.throws(() => parseSubscription("TEAM"))

  const budget = parseBudget(BUDGET)
  assert.equal(budget.apiBudget?.usagePercentage, 42.5)
  assert.equal(budget.apiBudget?.resetAt, "2026-12-01T00:00:00Z")
  assert.equal(budget.vibeBudget?.currency, null)
  assert.throws(() => parseBudget("nope"))

  const ws = parseWorkspaces(WORKSPACES)
  assert.equal(ws.workspace, "Acme Org")
  assert.equal(ws.workspaceId, "ws-1")
  assert.deepEqual(parseWorkspaces({ workspaces: [] }), {})
})

// ---- stored-credential fallback (OpenCode /api/credential) ----------------------

test("pickStoredMistralKey: returns the ACTIVE mistral key credential", () => {
  const entries = [
    { id: "c1", integrationID: "mistral", label: "Mistral", active: false, value: { type: "key", key: "sk-inactive" } },
    { id: "c2", integrationID: "linear", label: "linear-project", active: true, value: { type: "oauth", access: "tok" } },
    { id: "c3", integrationID: "mistral", label: "Mistral 2", active: true, value: { type: "key", key: "sk-active" } },
  ]
  assert.equal(pickStoredMistralKey(entries), "sk-active")
})

test("pickStoredMistralKey: ignores inactive / other integrations / non-key values / malformed entries", () => {
  assert.equal(pickStoredMistralKey(undefined), undefined)
  assert.equal(pickStoredMistralKey({}), undefined)
  assert.equal(pickStoredMistralKey([]), undefined)
  assert.equal(pickStoredMistralKey([null, 42, "x", { integrationID: "mistral" }]), undefined)
  assert.equal(pickStoredMistralKey([{ integrationID: "mistral", active: false, value: { type: "key", key: "sk-x" } }]), undefined)
  assert.equal(pickStoredMistralKey([{ integrationID: "other", active: true, value: { type: "key", key: "sk-x" } }]), undefined)
  assert.equal(pickStoredMistralKey([{ integrationID: "mistral", active: true, value: { type: "oauth", access: "tok" } }]), undefined)
  assert.equal(pickStoredMistralKey([{ integrationID: "mistral", active: true, value: { type: "key", key: "   " } }]), undefined)
  assert.equal(pickStoredMistralKey([{ integrationID: "mistral", active: true }]), undefined)
})

test("resolveStoredKey: mock client returns the active key; failures → undefined; never throws", async () => {
  const entries = [{ integrationID: "mistral", active: true, value: { type: "key", key: "sk-stored" } }]
  // Real generated client: credential.list() resolves to CredentialEntry[] directly
  const okClient = { credential: { list: async () => entries } }
  assert.equal(await resolveStoredKey(okClient), "sk-stored")
  // Tolerate a { data: [...] } wrapper as well
  const wrappedClient = { credential: { list: async () => ({ data: entries }) } }
  assert.equal(await resolveStoredKey(wrappedClient), "sk-stored")

  const throwingClient = { credential: { list: async () => { throw new Error("boom") } } }
  assert.equal(await resolveStoredKey(throwingClient), undefined)

  assert.equal(await resolveStoredKey(undefined), undefined)
  assert.equal(await resolveStoredKey({}), undefined)
  assert.equal(await resolveStoredKey({ credential: {} }), undefined)
  assert.equal(await resolveStoredKey({ credential: { list: async () => ({}) } }), undefined, "missing entries array")
})
