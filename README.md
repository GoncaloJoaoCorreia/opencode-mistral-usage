# opencode-mistral-usage

An [OpenCode](https://opencode.ai) plugin that shows your **Mistral budget usage** right in the
sidebar — no API keys in config, no environment variables:

```
▼ MISTRAL ◐
  API  ████████░░░░░░░░ 42%
  VIBE █████░░░░░░░░░░░ —
  11 days to reset
```

## Setup (2 minutes, zero config)

1. **Connect Mistral once in OpenCode**: run `/connect`, pick Mistral, paste your API key.
   The plugin automatically uses this stored credential (`opencode auth list` shows it as
   `stored`). Nothing is read from environment variables, and the key is never written to
   disk by the plugin.
2. **Point OpenCode at this plugin** — add one line to `~/.config/opencode/cli.json`:

   ```json
   {
     "plugins": ["/absolute/path/to/opencode-mistral-usage"]
   }
   ```

3. **Reload**: press `/reload` in a running TUI, or just start `opencode`. The MISTRAL section
   appears at the top of the sidebar. (Check registration with `opencode plugin list`.)

That's it. The section polls every 60 s on its own.

## Using it

- **Click the section header** to collapse/expand it — the state persists across restarts.
  Keyboard fallback: slash command `/mistral-toggle`.
- **Refresh on demand**: palette command **“Mistral: refresh usage”** (`Ctrl+P`) or slash
  `/mistral-usage`.
- **Bars**: `█`/`░` show the share of the current billing-period budget already used — green
  under 80 %, yellow under 95 %, red at 95 %+. `API` and `VIBE` each get a bar when their
  budget exists. Below the bars, one line shows the time until reset (`x days to reset`, or
  hours/minutes when it's closer).
- If something's off you'll see a plain hint instead of a crash, e.g. `connect Mistral via
  /connect to show usage` when no credential is stored, or `unauthorized 401 …` on a bad key.
  A 403 on the budget endpoint (missing `see_org_inference_usage` permission) just hides the
  bars with a muted note.

## Advanced configuration (rarely needed)

- **Custom plugin location**: instead of the `cli.json` path entry, copy/symlink this directory
  into `~/.config/opencode/plugins/opencode-mistral-usage/` or `<project>/.opencode/plugins/`.
- **Explicit key override** (object form — overrides the stored credential):

  ```json
  {
    "plugins": [
      { "path": "/absolute/path/to/opencode-mistral-usage", "options": { "apiKey": "…" } }
    ]
  }
  ```

- **Position in the sidebar**: the section is `prepend`ed to `sidebar.content` (top). Change the
  claim to `append` in `src/tui.tsx` to put it at the bottom.

Under the hood the plugin calls only `GET /v1/billing/subscription`, `GET /v1/billing/budget`
and `GET /v1/users/me/workspaces` on `https://api.mistral.ai` (standard key as `x-api-key` +
Bearer, 10 s timeout, all failures degrade to typed states). No admin endpoints are called.

## Development

```sh
npm install          # install dependencies (package-lock.json is committed)
npm run typecheck    # tsc --noEmit
npm test             # node --test test/ (node >= 22.18, runs .ts directly)
```

Verify in this order: `npm run typecheck && npm test`. No build, no lint, no CI.

Layout: `src/tui.tsx` (sidebar UI), `src/lib/mistral.ts` (API client, never throws),
`src/lib/format.ts` (pure bar/reset helpers), `test/` (node:test with mocked fetch).
See `AGENTS.md` for toolchain quirks and OpenCode plugin API gotchas.
