# opencode-mistral-usage

An [OpenCode](https://opencode.ai) TUI plugin (V2 plugin API) that adds a **Mistral** section to
the sidebar showing your current billing-period budget usage as a graphical bar with a relative
reset hint, and a collapsible header (click to collapse/expand, state persisted). Usage is
polled every 60 s and can be refreshed manually via a palette command.

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

- **API key: stored credential only.** The plugin reads the **active** `mistral` key credential
  from OpenCode's local API (`GET /api/credential`, i.e. `context.client.credential.list()`) —
  the `stored` entry shown by `opencode auth list` (set it via `/connect`). Environment
  variables are not read. The key is used in memory only — never logged, never persisted.
- Plugin options can be passed via the object form of the `cli.json` `plugins` entry (see above).

## Development

```sh
npm install        # install dependencies (produces package-lock.json)
npm run typecheck  # tsc --noEmit
npm test           # node --test test/
```

## Usage display (the sidebar section)

When the plugin is loaded, a **MISTRAL** section appears in the TUI sidebar
(slot `sidebar.content`, prepended above the built-in content — switch the claim to
`append` to place it at the bottom instead):

```
▼ MISTRAL ◐
  API  ████████░░░░░░░░ 42%
  VIBE █████░░░░░░░░░░░ —   ← second bar row when vibe_budget is present
  11 days to reset          ← one shared reset hint below the bars (bars aligned)
```

- **Header row** shows `▼`/`▶` + `MISTRAL` (+ a `◐` while refreshing).
  **Click the header row** to collapse/expand the section — the click handler is
  `onMouseDown` on the header `<text>` element. The collapsed state is persisted
  (host durable storage), so it survives TUI restarts and hot reloads.
- **Budget bar**: `█`/`░` cells from `usage_percentage` (`/v1/billing/budget`), colored
  green < 80 %, yellow < 95 %, red ≥ 95 %, followed by the percentage. `VIBE` gets a
  second bar row when `vibe_budget` is present. Below the bars, one shared relative
  reset hint — `x days to reset`, or hours/minutes when the reset is closer (API and
  VIBE reset together, so it is shown once). The bar is a fixed 20 cells wide (the
  slot input exposes no width). No plan name or currency amounts are shown.
- **Polling**: usage is fetched on load and every 60 s. **Refresh manually** with the
  palette command **“Mistral: refresh usage”** (`Ctrl+P`) or the slash command
  `/mistral-usage` in the prompt. **“Mistral: collapse/expand section”** (slash
  `/mistral-toggle`) is the keyboard fallback for the header click.
- **Graceful states** (the sidebar never crashes):
  - no stored credential → hint line `connect Mistral via /connect to show usage`;
  - 401 → `unauthorized 401 — check the stored Mistral credential`; 403 on the budget endpoint →
    a muted `budget unavailable: forbidden 403 …` note (plan still shown);
  - network/timeout/parse failures → typed error lines.

## Configuration details

- Keys are read per refresh and are never written to disk. Resolution order:
  1. plugin options (cli.json object form, `apiKey`),
  2. the **active stored `mistral` credential** via the local OpenCode API — the normal path;
     environment variables are not read.
  - the standard key is sent as `x-api-key` **and** `Authorization: Bearer` to
    `/v1/billing/subscription`, `/v1/billing/budget`, `/v1/users/me/workspaces`.
  - Only these billing/users endpoints are called — no `/v1/admin/*` requests.
- Object-form plugin options can pass the key explicitly (overrides the stored credential):

  ```json
  {
    "plugins": [
      { "path": "/absolute/path/to/opencode-mistral-usage", "options": { "apiKey": "…" } }
    ]
  }
  ```
- `/v1/billing/budget` may 403 without the `see_org_inference_usage` permission —
  the section then shows the plan without the bar plus a muted note.
- Requests have a 10 s timeout; all failures degrade to typed states
  (`no-key` / `unauthorized` / `forbidden` / `http` / `network` / `parse`).
