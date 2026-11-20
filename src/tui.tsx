/** @jsxImportSource @opentui/solid */
// opencode-mistral-usage — TUI-only OpenCode plugin.
//
// Adds a "MISTRAL" section to the sidebar (slot: sidebar.content, appended) showing the
// current Mistral plan and a graphical bar for the billing-period budget usage
// (/v1/billing/budget api_budget / vibe_budget), plus admin spend-limit / rate-limit rows
// when MISTRAL_ADMIN_API_KEY is configured and accepted.
//
// - Header row is a <text> element with onMouseDown (a <text> is a scene Renderable, so the
//   handler attaches and hit-testing reaches it; handlers on <span> children are silently
//   dropped by the @opentui/solid reconciler — never put onMouse* on a <span>). Clicking
//   toggles collapse, persisted via context.storage.store so it survives restarts.
// - Keyboard/palette fallback: "Mistral: refresh usage" and "Mistral: collapse/expand section"
//   commands in a global keymap layer (palette + slash).
// - Usage is polled every 60 s and refreshed immediately on load and on command.
// - Graceful states: no key → hint line; 401/403/network/parse → typed error lines;
//   per-section errors render as small muted notes. The render path never throws — every
//   host call is wrapped defensively so API drift cannot crash the sidebar.
import { createSignal, For, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
// @ts-ignore -- the host loader and node type stripping use the explicit .ts extension (TS5097 without allowImportingTsExtensions)
import { fetchUsage, resolveKeys, type KeyOptions, type UsageError, type UsageSnapshot } from "./lib/mistral.ts"
// @ts-ignore -- see above
import { barLevel, formatMoney, formatNumber, formatResetAt, renderBar, type BudgetDetailInfo } from "./lib/format.ts"

const POLL_MS = 60_000
const BAR_WIDTH = 20 // fixed bar cells; the sidebar.content slot input exposes no width (Q4), so we try a defensive read and fall back to this

// ---- defensive theme tokens (custom themes may omit entries; dig with hex fallbacks) ----

type ThemeLike = Record<string, unknown>

function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function color(theme: ThemeLike, paths: string[], fallback: string): unknown {
  for (const p of paths) {
    const v = dig(theme, p)
    if (v != null) return v
  }
  return fallback
}

function palette(theme: ThemeLike) {
  return {
    base: color(theme, ["text.base", "text.default"], "#e6edf3"),
    muted: color(theme, ["text.muted", "text.subdued", "text.faint"], "#8b949e"),
    accent: color(theme, ["text.action.primary.base", "text.action.primary.default", "accent", "primary"], "#58a6ff"),
    success: color(theme, ["text.feedback.success.base", "text.feedback.success.default", "success"], "#3fb950"),
    warning: color(theme, ["text.feedback.warning.base", "text.feedback.warning.default", "warning"], "#d29922"),
    error: color(theme, ["text.feedback.error.base", "text.feedback.error.default", "error"], "#f85149"),
  }
}

type Palette = ReturnType<typeof palette>

// ---- small pure helpers ---------------------------------------------------------------

/** Short human label for a typed UsageError (401/403/network/… states). */
function errorText(e: UsageError): string {
  const status = e.status != null ? ` ${e.status}` : ""
  switch (e.kind) {
    case "no-key":
      return "no API key"
    case "unauthorized":
      return `unauthorized${status} — check MISTRAL_API_KEY`
    case "forbidden":
      return `forbidden${status} — missing permission`
    case "http":
      return `HTTP${status}`
    case "network":
      return "network error"
    case "parse":
      return "unparseable response"
  }
}

/** Defensive bar width: use the slot input's width when it exposes one, else 20 cells. */
function barWidth(input: unknown): number {
  try {
    const w = (input as { width?: unknown } | null | undefined)?.width
    if (typeof w === "number" && Number.isFinite(w)) {
      const cells = Math.floor(w) - 26 // reserve label + pct + amounts
      if (cells >= 8 && cells <= 40) return cells
    }
  } catch {
    /* input shape drift — fall through */
  }
  return BAR_WIDTH
}

/** Top models by tokens_per_minute for the admin rate-limit rows. */
function topModels(snapshot: UsageSnapshot): Array<{ model: string; tpm: number }> {
  const map = snapshot.admin?.rateLimits?.tokensLimitsByModel
  if (!map) return []
  return Object.entries(map)
    .map(([model, v]) => ({ model, tpm: v.tokensPerMinute ?? 0 }))
    .sort((a, b) => b.tpm - a.tpm)
    .slice(0, 3)
}

// ---- the plugin -----------------------------------------------------------------------

export default Plugin.define({
  id: "opencode-mistral-usage",
  setup(context) {
    const [snapshot, setSnapshot] = createSignal<UsageSnapshot | null>(null)
    const [loading, setLoading] = createSignal(true)

    // Persisted collapse state (survives restarts; storage.store is durable JSON).
    // Wrapped so a storage API change degrades to an ephemeral signal instead of
    // failing plugin setup.
    let collapsed: () => boolean
    let toggleCollapsed: () => void
    try {
      const [store, update] = context.storage.store("sidebar.collapsed", { initial: { value: false } })
      collapsed = () => store.value === true
      toggleCollapsed = () => {
        void update((draft: { value: boolean }) => {
          draft.value = !(draft.value === true)
        }).catch(() => {})
      }
    } catch {
      const [c, setC] = createSignal(false)
      collapsed = () => c()
      toggleCollapsed = () => setC(!c())
    }

    let refreshing = false
    async function refresh(): Promise<void> {
      if (refreshing) return
      refreshing = true
      setLoading(true)
      try {
        // Keys resolved per refresh: options first (cli.json object form), then env —
        // so a changed MISTRAL_API_KEY is picked up on the next poll.
        const keys = resolveKeys(context.options as KeyOptions)
        setSnapshot(await fetchUsage(keys))
      } catch (err) {
        // fetchUsage never throws; this is the absolute last resort.
        setSnapshot({
          fetchedAt: new Date().toISOString(),
          error: { kind: "network", message: err instanceof Error ? err.message : String(err) },
        })
      } finally {
        refreshing = false
        setLoading(false)
      }
    }

    // One budget bar row (API / VIBE). Colored by barLevel: ok < 80, warn < 95, error >= 95.
    function BarRow(props: { label: string; detail: BudgetDetailInfo | undefined; width: number; c: Palette }) {
      const bar = () => renderBar(props.detail?.usagePercentage, props.width)
      const color = () => {
        const level = barLevel(props.detail?.usagePercentage)
        return level === "error" ? props.c.error : level === "warn" ? props.c.warning : props.c.success
      }
      const usage = () => {
        const pct = props.detail?.usagePercentage
        const init = props.detail?.initialBudget
        return pct != null && init != null ? (init * pct) / 100 : null
      }
      const pctText = () => {
        const pct = bar().pct
        if (pct === null) return "  —"
        return ` ${pct.toFixed(0)}%  ${formatMoney(usage(), props.detail?.currency)}/${formatMoney(props.detail?.initialBudget, props.detail?.currency)}`
      }
      return (
        <text>
          <span style={{ fg: props.c.muted }}>{`  ${props.label} `}</span>
          <span style={{ fg: color() }}>{bar().filled}</span>
          <span style={{ fg: props.c.muted }}>{bar().empty}</span>
          <span style={{ fg: props.c.base }}>{pctText()}</span>
          <Show when={props.detail?.resetAt != null}>
            <span style={{ fg: props.c.muted }}>{`  reset ${formatResetAt(props.detail?.resetAt)}`}</span>
          </Show>
        </text>
      )
    }

    function Section(props: { input: unknown }) {
      const c = () => palette(((context as { theme?: unknown }).theme ?? {}) as ThemeLike)
      const snap = () => snapshot()
      const width = () => barWidth(props.input)
      const planLabel = () => {
        const s = snap()
        if (!s || s.error || s.plan?.error) return ""
        return s.plan?.planName ? ` ${s.plan.planName}` : ""
      }
      return (
        <box flexDirection="column" marginTop={1}>
          {/* Click target: onMouseDown on the <text> element itself — never on a <span>. */}
          <text onMouseDown={() => toggleCollapsed()}>
            <span style={{ fg: c().accent, bold: true }}>{collapsed() ? "▶" : "▼"}{" MISTRAL"}</span>
            <span style={{ fg: c().muted }}>{planLabel()}</span>
            <Show when={loading()}>
              <span style={{ fg: c().muted }}>{" ◐"}</span>
            </Show>
          </text>
          <Show when={!collapsed()}>
            <Show when={!snap()}>
              <text>
                <span style={{ fg: c().muted }}>{"  loading…"}</span>
              </text>
            </Show>
            <Show when={snap()?.error?.kind === "no-key"}>
              <text>
                <span style={{ fg: c().muted }}>{"  set MISTRAL_API_KEY to show usage"}</span>
              </text>
            </Show>
            <Show when={snap() != null && snap()?.error?.kind !== "no-key"}>
              <Show when={snap()?.error != null}>
                <text>
                  <span style={{ fg: c().warning }}>{"  ⚠ "}{snap()?.error ? errorText(snap()!.error!) : ""}</span>
                </text>
              </Show>
              <Show when={snap()?.plan != null && snap()?.plan?.error != null}>
                <text>
                  <span style={{ fg: c().warning }}>{"  plan: "}{snap()?.plan?.error ? errorText(snap()!.plan!.error!) : ""}</span>
                </text>
              </Show>
              <Show when={snap()?.plan != null && snap()?.plan?.error == null}>
                <text>
                  <span style={{ fg: c().base }}>{"  Plan "}{snap()?.plan?.planName ?? "—"}</span>
                  <Show when={snap()?.plan?.paygEnabled === true}>
                    <span style={{ fg: c().muted }}>{"  PAYG"}</span>
                  </Show>
                  <Show when={snap()?.workspace != null}>
                    <span style={{ fg: c().muted }}>{"  · "}{snap()?.workspace}</span>
                  </Show>
                </text>
              </Show>
              <Show when={snap()?.budget?.apiBudget != null}>
                <BarRow label="API" detail={snap()?.budget?.apiBudget} width={width()} c={c()} />
              </Show>
              <Show when={snap()?.budget?.vibeBudget != null}>
                <BarRow label="VIBE" detail={snap()?.budget?.vibeBudget} width={width()} c={c()} />
              </Show>
              <Show when={snap()?.budget?.error != null}>
                <text>
                  <span style={{ fg: c().muted }}>{"  budget unavailable: "}{snap()?.budget?.error ? errorText(snap()!.budget!.error!) : ""}</span>
                </text>
              </Show>
              {/* Admin rows: only rendered when an admin key was configured (snapshot.admin). */}
              <Show when={snap()?.admin != null}>
                <Show when={snap()?.admin?.spendLimit?.completion != null}>
                  <text>
                    <span style={{ fg: c().muted }}>{"  Limit "}</span>
                    <span style={{ fg: c().base }}>
                      {formatMoney(snap()?.admin?.spendLimit?.completion?.usage)}
                      {"/"}
                      {snap()?.admin?.spendLimit?.completion?.usageLimit == null
                        ? "—"
                        : formatMoney(snap()?.admin?.spendLimit?.completion?.usageLimit)}
                    </span>
                    <Show when={snap()?.admin?.spendLimit?.completion?.monthlyLimitReached === true}>
                      <span style={{ fg: c().error }}>{"  reached"}</span>
                    </Show>
                  </text>
                </Show>
                <Show when={snap()?.admin?.spendLimit?.error != null}>
                  <text>
                    <span style={{ fg: c().muted }}>{"  spend-limit: "}{snap()?.admin?.spendLimit?.error ? errorText(snap()!.admin!.spendLimit!.error!) : ""}</span>
                  </text>
                </Show>
                <Show when={snap()?.admin?.rateLimits?.requestsPerSecond != null}>
                  <text>
                    <span style={{ fg: c().muted }}>{"  RPS "}</span>
                    <span style={{ fg: c().base }}>{String(snap()?.admin?.rateLimits?.requestsPerSecond)}</span>
                  </text>
                </Show>
                <For each={topModels(snap() ?? ({} as UsageSnapshot))}>
                  {(m) => (
                    <text>
                      <span style={{ fg: c().muted }}>{"  "}{m.model}{" "}</span>
                      <span style={{ fg: c().base }}>{formatNumber(m.tpm)}{" tpm"}</span>
                    </text>
                  )}
                </For>
                <Show when={snap()?.admin?.rateLimits?.error != null}>
                  <text>
                    <span style={{ fg: c().muted }}>{"  rate-limit: "}{snap()?.admin?.rateLimits?.error ? errorText(snap()!.admin!.rateLimits!.error!) : ""}</span>
                  </text>
                </Show>
              </Show>
            </Show>
          </Show>
        </box>
      )
    }

    // Sidebar slot. The whole render is guarded: the sidebar must never crash the TUI.
    let unregisterSlot: (() => void) | undefined
    try {
      unregisterSlot = context.ui.slot({
        append: "sidebar.content",
        render: (input) => {
          try {
            return <Section input={input} />
          } catch {
            return <text>{"MISTRAL"}</text>
          }
        },
      })
    } catch {
      unregisterSlot = undefined // slot API drift — commands/polling still work
    }

    // Keyboard/palette fallback commands (mouse click is the primary collapse affordance).
    try {
      context.keymap.layer(() => ({
        mode: "global",
        priority: 10,
        commands: [
          {
            id: "mistral-usage.refresh",
            title: "Mistral: refresh usage",
            group: "Mistral",
            palette: true,
            slash: { name: "mistral-usage", aliases: ["mistral"] },
            run: () => {
              void refresh()
            },
          },
          {
            id: "mistral-usage.toggle",
            title: "Mistral: collapse/expand section",
            group: "Mistral",
            palette: true,
            slash: { name: "mistral-toggle" },
            run: () => toggleCollapsed(),
          },
        ],
        bindings: ["mistral-usage.refresh", "mistral-usage.toggle"],
      }))
    } catch {
      /* keymap API drift — the slot still renders */
    }

    void refresh()
    const poll = setInterval(() => {
      void refresh()
    }, POLL_MS)

    return () => {
      try {
        unregisterSlot?.()
      } catch {
        /* already gone */
      }
      clearInterval(poll)
    }
  },
})
