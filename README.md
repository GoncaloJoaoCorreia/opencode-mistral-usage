# opencode-mistral-usage

An [OpenCode](https://opencode.ai) TUI plugin (V2 plugin API) that adds a **Mistral** section to
the sidebar showing your Mistral plan usage and limits: the plan name, a graphical bar for the
current billing-period budget usage, and a collapsible header (click to collapse/expand, state
persisted). Usage is polled every 60 s and can be refreshed manually via a palette command.

## Install / loading

This is a TUI-only package: its only export is `./tui` (`src/tui.tsx`). Load it in one of these
ways:

1. **`cli.json` plugins entry** (local path):

   ```json
   {
     "plugins": ["/absolute/path/to/opencode-mistral-usage"]
   }
   ```

   or with options (object form):

   ```json
   {
     "plugins": [{ "path": "/absolute/path/to/opencode-mistral-usage", "options": {} }]
   }
   ```

2. **Plugin discovery**: copy or symlink this directory to
   `<config>/plugins/opencode-mistral-usage/` (e.g. `~/.config/opencode/plugins/`) or
   `<project>/.opencode/plugins/opencode-mistral-usage/`.

## Configuration

- `MISTRAL_API_KEY` (optional when a stored credential exists): your Mistral API key, read from
  the environment only — never stored on disk. Used for `/v1/billing/subscription` (plan name)
  and `/v1/billing/budget` (current-period budget usage) via `x-api-key` / `Authorization: Bearer`.
- **Stored-credential fallback**: when no `MISTRAL_API_KEY` is set, the plugin asks the local
  OpenCode API (`GET /api/credential`, i.e. `context.client.credential.list()`) for the
  **active** `mistral` key credential (the `stored` one shown by `opencode auth list`).
  The key is used in memory only — never logged, never persisted.
- `MISTRAL_ADMIN_API_KEY` (optional): an admin-scoped key that enables the `/v1/admin/*` rows
  (spend limit, rate limit, usage). When absent or rejected, those rows are hidden and the
  plugin degrades gracefully.
- Plugin options can be passed via the object form of the `cli.json` `plugins` entry (see above).

## Development

```sh
npm install        # install dependencies (produces package-lock.json)
npm run typecheck  # tsc --noEmit
npm test           # node --test test/
```

## Usage display (the sidebar section)

When the plugin is loaded, a **MISTRAL** section appears in the TUI sidebar
(slot `sidebar.content`, appended below the built-in content):

```
▼ MISTRAL ◐
  API ████████░░░░░░░░ 42%  11 days to reset
  VIBE ░░░░░░░░░░░░░░░░ —   ← second bar row when vibe_budget is present
  RPS 5                  ← only with MISTRAL_ADMIN_API_KEY
  mistral-large-latest 12.5k tpm   ← top models by tokens/min, admin key only
  spend limit reached    ← only when the admin spend limit is hit
```

- **Header row** shows `▼`/`▶` + `MISTRAL` (+ a `◐` while refreshing).
  **Click the header row** to collapse/expand the section — the click handler is
  `onMouseDown` on the header `<text>` element. The collapsed state is persisted
  (host durable storage), so it survives TUI restarts and hot reloads.
- **Budget bar**: `█`/`░` cells from `usage_percentage` (`/v1/billing/budget`), colored
  green < 80 %, yellow < 95 %, red ≥ 95 %, followed by the percentage and a relative
  reset hint — `x days to reset`, or hours/minutes when the reset is closer.
  `VIBE` gets a second bar row when `vibe_budget` is present. The bar is a fixed
  20 cells wide (the slot input exposes no width). No plan name or currency amounts
  are shown.
- **Polling**: usage is fetched on load and every 60 s. **Refresh manually** with the
  palette command **“Mistral: refresh usage”** (`Ctrl+P`) or the slash command
  `/mistral-usage` in the prompt. **“Mistral: collapse/expand section”** (slash
  `/mistral-toggle`) is the keyboard fallback for the header click.
- **Graceful states** (the sidebar never crashes):
  - no `MISTRAL_API_KEY` and no stored credential → hint line `set MISTRAL_API_KEY to show usage`;
  - 401 → `unauthorized 401 — check the API key`; 403 on the budget endpoint →
    a muted `budget unavailable: forbidden 403 …` note (plan still shown);
  - network/timeout/parse failures → typed error lines;
  - admin rows render only when an admin key is configured; a rejected admin key
    shows small muted notes instead of the rows.

## Configuration details

- Keys are read per refresh — plugin options (object form) first, then the environment, then
  the active stored `mistral` credential via the local OpenCode API — and are never written
  to disk:
  - `MISTRAL_API_KEY` — standard key. Sent as `x-api-key` **and** `Authorization: Bearer`
    to `/v1/billing/subscription`, `/v1/billing/budget`, `/v1/users/me/workspaces`.
  - `MISTRAL_ADMIN_API_KEY` — admin-scoped key, sent as `Authorization: Bearer` only to
    `/v1/admin/spend-limit`, `/v1/admin/rate-limit`, `/v1/admin/usage`. Standard keys are
    rejected there, so without an admin key those rows are simply absent.
- Object-form plugin options can pass the keys explicitly (takes precedence over env):

  ```json
  {
    "plugins": [
      { "path": "/absolute/path/to/opencode-mistral-usage", "options": { "apiKey": "…", "adminApiKey": "…" } }
    ]
  }
  ```

  Prefer the environment variables; do not put secrets in `cli.json`.
- `/v1/billing/budget` may 403 without the `see_org_inference_usage` permission —
  the section then shows the plan without the bar plus a muted note.
- Requests have a 10 s timeout; all failures degrade to typed states
  (`no-key` / `unauthorized` / `forbidden` / `http` / `network` / `parse`).
