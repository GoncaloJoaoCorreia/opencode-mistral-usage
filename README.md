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

- `MISTRAL_API_KEY` (required): your Mistral API key, read from the environment only — never
  stored on disk. Used for `/v1/billing/subscription` (plan name) and `/v1/billing/budget`
  (current-period budget usage) via `x-api-key` / `Authorization: Bearer`.
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

## Usage display (placeholder)

_The sidebar section content (plan name, usage bar, limits) is implemented by the `sidebar-ui`
task; this scaffold only provides the compiling plugin stub._

## Configuration details (placeholder)

_Endpoint/permission specifics and graceful-degradation states are documented by the
`mistral-client` task._
