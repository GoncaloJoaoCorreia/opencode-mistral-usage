# opencode-mistral-usage

An [OpenCode](https://opencode.ai) plugin that shows your **Mistral budget usage** right in the
sidebar:

```
▼ MISTRAL ◐
  API  ████████░░░░░░░░ 42%
  VIBE █████░░░░░░░░░░░ 27%
  11 days to reset
```

## Setup (one command)

1. **Connect Mistral once in OpenCode**: run `/connect`, pick Mistral, paste your API key.
   The plugin automatically uses this stored credential.
2. **Install the plugin**:

   ```sh
   opencode plugin add github:GoncaloJoaoCorreia/opencode-mistral-usage
   ```

   This clones the repo, installs it into OpenCode's managed package store, and adds the
   entry to your global `cli.json` automatically — no manual config editing.
3. **Reload**: press `/reload` in a running TUI, or just start `opencode`. The MISTRAL
   section appears at the top of the sidebar.

Afterwards: `opencode plugin list` shows it (source + commit), `opencode plugin update`
pulls updates, `opencode plugin remove github:GoncaloJoaoCorreia/opencode-mistral-usage`
uninstalls it.

That's it — zero config beyond the one command. The section polls every 60 s on its own.

## Using it

- **Click the section header** to collapse/expand it — the state persists across restarts.
  Keyboard fallback: slash command `/mistral-toggle`.
- **Refresh on demand**: palette command **“Mistral: refresh usage”** (`Ctrl+P`) or slash
  `/mistral-usage`.
- **Bars**: `█`/`░` show the share of the current billing-period budget already used — green
  under 80 %, yellow under 95 %, red at 95 %+. `API` and `VIBE` each get a bar when their
  budget exists. Below the bars, one line shows the time until reset.

## Advanced configuration

- **Local checkout instead of the GitHub install**: copy/symlink a clone of this repo into
  `~/.config/opencode/plugins/opencode-mistral-usage/` or `<project>/.opencode/plugins/` —
  see Development below.
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

Clone the repo and point OpenCode at the local path (live code — edits apply on `/reload`,
no reinstall):

```sh
git clone https://github.com/GoncaloJoaoCorreia/opencode-mistral-usage.git
```

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-mistral-usage"]
}
```

```sh
npm install          # install dependencies (package-lock.json is committed)
npm run typecheck    # tsc --noEmit
npm test             # node --test test/ (node >= 22.18, runs .ts directly)
```

Verify in this order: `npm run typecheck && npm test`. No build, no lint, no CI.

Layout: `src/tui.tsx` (sidebar UI), `src/lib/mistral.ts` (API client, never throws),
`src/lib/format.ts` (pure bar/reset helpers), `test/` (node:test with mocked fetch).
