# AGENTS.md — opencode-mistral-usage

TUI-only OpenCode V2 plugin (no build step). One package; the only export is `./tui` → `src/tui.tsx`.

```
src/tui.tsx          sidebar section UI (slot claim, polling, collapse, keymap commands)
src/lib/mistral.ts   typed Mistral API client — never throws, degrades to typed UsageError
src/lib/format.ts    pure helpers (renderBar, barLevel, formatResetIn, ...)
test/*.test.ts       node:test, mocked fetchImpl — never hit the live API
test/index.js        shim so `node --test test/` works on Node 22 (see quirks)
```

## Commands

```sh
npm install          # lockfile is committed
npm run typecheck    # tsc --noEmit
npm test             # node --test test/
```

No lint, no CI, no build. Verify in this order: `npm run typecheck && npm test`.

## Toolchain quirks (hard-earned)

- **Node ≥ 22.18 required** (env: v22.23.3) — tests run as raw `.ts` via type stripping. Use **erasable TS only** (no enums / namespaces / parameter properties).
- tsconfig has no `allowImportingTsExtensions`, so relative imports need the explicit `.ts` extension **plus a `// @ts-ignore` line** (TS5097) to satisfy both `tsc` and Node type stripping. Pattern is already in `src/tui.tsx` / `test/*.ts`.
- `src/tui.tsx` needs a per-file `/** @jsxImportSource @opentui/solid */` pragma — tsconfig pins `jsxImportSource: solid-js`, which lacks OpenTUI JSX intrinsics.
- `npm install` prints an `EBADENGINE` warning (`@opentui/core` wants node ≥ 26) — harmless on v22; install/tsc/tests all pass.
- `node --test test/` only works because of `test/index.js` (Node 22 treats a bare directory arg as a glob/script). Bare `node --test` discovers tests directly.

## OpenCode plugin API gotchas (verified against @opencode/plugin 2.3.2)

- V2 shape: `export default Plugin.define({ id, setup(context) })` imported from `@opencode/plugin/tui`.
- Slots: `context.ui.slot({ prepend | append | before | after | replace: "sidebar.content", render })` — exactly one placement key; same-anchor claims coexist in **plugin enable order**. This plugin uses `prepend` (top of sidebar); `append` puts it at the bottom.
- **Mouse handlers go on `<text>` elements (`onMouseDown`), never on `<span>`** — span handlers are silently dropped by the reconciler.
- `context.client.credential.list()` resolves to `CredentialEntry[]` **directly** — do NOT read `.data` off the result (that bug shipped once; see commit `bfc769d`).
- The `sidebar.content` slot input exposes only `{ sessionID }` — no width → bars are a fixed 20 cells.
- Load for local dev via `cli.json`: `{"plugins": ["/abs/path/to/this/repo"]}` (path entry = live code, just `/reload` in the TUI). Confirm with `opencode plugin list`. Discovery dir `~/.config/opencode/plugins/<name>/` also works but is a copy.

## Keys / API

- Base `https://api.mistral.ai`. Billing endpoints take the standard key as `x-api-key` **and** `Authorization: Bearer`; `/v1/admin/*` take the admin key as Bearer only (standard keys are rejected there).
- Key resolution per refresh: plugin options (cli.json object form) → `MISTRAL_API_KEY` env → active stored `mistral` credential via local `GET /api/credential`. **Never log or persist keys** — in-memory only.
- `MISTRAL_ADMIN_API_KEY` (env or options) enables the admin rows; absent/rejected → rows hidden, typed notes instead.

## UI conventions in this repo (deliberate — don't "fix" them)

- Bar rows: label padded to 5 cells (`padEnd(5)`) so API/VIBE bars align vertically; then bar + `42%`. No plan name, no currency amounts.
- One shared reset line below the bars: `formatResetIn()` → `x days to reset` (hours/minutes when closer, `reset due` when past). API and VIBE reset together.
- Collapse state persisted via `context.storage.store`; poll every 60 s; palette/slash commands `/mistral-usage` (refresh) and `/mistral-toggle` (collapse fallback).
- The render path must never crash the host TUI — wrap host calls in try/catch.

## Repo hygiene

- `.gitignore` covers `node_modules/`, `dist/`, `.plan/` (driver-cycle artifacts are local-only).
- Branch `feat/<SLUG>`; conventional commits `feat(scope): …` / `fix(scope): …`. Driver-cycle commits add `Refs: MPLUGIN-1` / `Driver-Task:` trailers.
- README.md is the user-facing doc (install, config, display); keep it in sync with UI changes.
