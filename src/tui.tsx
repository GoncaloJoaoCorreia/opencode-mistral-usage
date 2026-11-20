import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "opencode-mistral-usage",
  setup(_context) {
    // TODO(sidebar-ui): register a sidebar.content slot section with the
    // Mistral plan usage bar, collapsible header, and 60s polling.
    return () => {}
  },
})
