# Installing Godotwright (for AI agents such as Cline)

Godotwright is an MCP server for Godot 4.7 projects. It runs locally over stdio with `npx`; there is nothing to clone or
build, and it needs no API key.

## Requirements

- Node.js 22.12 or newer (`node --version`).
- A Godot 4 project (a folder with `project.godot`).
- Optional: Godot 4.7, for the tools that run the game (`godot_check`, `godot_test`, `godot_play`, `godot_screenshot`,
  `godot_session`, `godot_perf`). Godotwright finds it on `PATH`, in the usual install folders, or through the `GODOT`
  environment variable. Review, API lookup, the project map, migration and the edits work without it.

## Add the server

Add this entry to the MCP settings (for Cline: `cline_mcp_settings.json`, under `mcpServers`):

```json
{
  "mcpServers": {
    "godotwright": {
      "command": "npx",
      "args": ["-y", "godotwright", "mcp", "--tier", "premium", "--project", "/absolute/path/to/the/godot/project"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

- Replace `/absolute/path/to/the/godot/project` with the folder that holds `project.godot`. Without `--project`, the
  server uses the working directory.
- `--tier premium` gives full detail for large models; `--tier cheap` gives short output and step-by-step instructions
  for small models.
- If Godot is not found, add `"env": { "GODOT": "/path/to/godot" }`.
- The first start downloads the package from npm, which can take up to 30 seconds.

## Check that it works

Call `godot_scan` (a map of the project) or `godot_review` (a scored review of its scripts). Both work without Godot.
For something broken, start with `godot_doctor`.

## What it writes and sends

Tools that change files show the change first and write only with `write: true`; `godot_undo` takes writes back. It
sends nothing: there is no telemetry, and anonymous sharing is off unless the user turns it on. See
[PRIVACY.md](PRIVACY.md).
