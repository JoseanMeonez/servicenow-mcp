# servicenow-mcp

Standalone [MCP](https://modelcontextprotocol.io) server for ServiceNow. Exposes the Table,
Aggregate, and schema APIs as tools, with an **in-process update-set write gate**: write tools
are only registered when explicitly enabled, and every write is refused while your current
update set is "Default".

Works with Claude Code, Claude Desktop, and any other MCP client (stdio transport).

## Requirements

- Node.js >= 20.6
- A ServiceNow instance reachable with Basic Auth (username/password)

## Install

```bash
git clone https://github.com/JoseanMeonez/servicenow-mcp.git
cd servicenow-mcp
npm install
npm run build
```

## Configuration

All configuration is via environment variables (a `.env` file in the repo root is also loaded
when present — see `.env.example`):

| Variable                    | Default      | Description                                                |
| --------------------------- | ------------ | ---------------------------------------------------------- |
| `SN_BASE_URL`               | — (required) | Instance URL, e.g. `https://dev12345.service-now.com`      |
| `SN_USERNAME`               | — (required) | Basic Auth username                                        |
| `SN_PASSWORD`               | — (required) | Basic Auth password                                        |
| `SN_MCP_ALLOW_WRITES`       | `false`      | Register write tools (create/update/delete/set update set) |
| `SN_MCP_REQUIRE_UPDATE_SET` | `true`       | Refuse writes while the current update set is "Default"    |
| `SN_MCP_DEFAULT_LIMIT`      | `50`         | Default query page size                                    |
| `SN_MCP_MAX_LIMIT`          | `500`        | Hard ceiling on any requested limit                        |
| `SN_MCP_REQUEST_TIMEOUT_MS` | `30000`      | Per-request timeout                                        |
| `SN_MCP_RETRY_MAX_ATTEMPTS` | `3`          | Attempts for 429/5xx responses (honors `Retry-After`)      |

Changing `SN_MCP_ALLOW_WRITES` requires restarting the MCP server process — tools are
registered at startup, not per call.

## Instance user setup (required per instance)

Recent ServiceNow releases do **not** accept Basic Auth on the REST API by default. For every
instance you connect, the user in `SN_USERNAME` must be set up as follows:

1. **Roles**: grant `snc_basic_auth_api_access` (mandatory for Basic Auth REST access) plus
   the roles needed for the tables you will touch. On a personal dev instance `admin` is fine;
   at work prefer least-privilege roles over `admin`.
2. **Integration user flag**: on the `sys_user` record, set `internal_integration_user = true`.
3. **Recommended**: use a dedicated integration user (e.g. `api.tester`), never a personal or
   the `admin` account, so API access can be rotated or revoked independently.

Symptom when this is missing: every request fails with
`401 "User is not authenticated"` even though the credentials are correct. The server's error
output includes this hint automatically on 401 responses.

## Register with Claude Code

```bash
claude mcp add servicenow-mcp -- node C:/Users/you/path/to/servicenow-mcp/dist/index.js
```

or copy `.mcp.json.example` into your project's `.mcp.json` and adjust path + env.

## Register with Claude Desktop

Claude Desktop uses a different config file than Claude Code:
`%APPDATA%\Claude\claude_desktop_config.json` (Windows). Add under `mcpServers`, using the
full path to `node.exe` (Desktop may not inherit your shell PATH):

```json
{
  "mcpServers": {
    "servicenow-dev": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "--env-file=C:/path/to/servicenow-mcp/instances/dev.env",
        "C:/path/to/servicenow-mcp/dist/index.js"
      ]
    }
  }
}
```

Then fully quit Claude Desktop (system tray → Quit, not just closing the window) and
reopen it — the config is only read at startup.

## Multiple instances

The recommended pattern is **one server process per instance**, each declared as its own
entry in `.mcp.json` and pointed at a per-instance profile file via Node's native
`--env-file` flag (before the script path):

```json
{
  "mcpServers": {
    "servicenow-dev": {
      "command": "node",
      "args": ["--env-file=/path/to/instances/dev.env", "/path/to/dist/index.js"]
    },
    "servicenow-prod": {
      "command": "node",
      "args": ["--env-file=/path/to/instances/prod.env", "/path/to/dist/index.js"]
    }
  }
}
```

Node fails fast if the profile file is missing, and real environment variables take
precedence over file values.

Why per-process instead of one multi-tenant server:

- **Zero shared state.** The server holds no caches and no sessions (see below); separate
  processes make cross-instance leakage structurally impossible, not just avoided.
- **Per-instance write policy.** A prod profile with `SN_MCP_ALLOW_WRITES=false` (or simply
  omitting it) never even registers write tools — the client cannot call what does not exist.
- **Clear tool naming.** Tools surface as `mcp__servicenow-dev__*` vs `mcp__servicenow-prod__*`,
  so it is always explicit which instance a call targets.
- **Independent rate limits.** ServiceNow enforces inbound REST rate limits per user per
  instance, so parallel processes against different instances never interact.

To add a new instance in one step, use the helper — it writes the profile file with correct
password quoting and prints the registration command:

```bash
npm run add-instance -- work https://mycompany.service-now.com api.integration 'the-password'
```

Keep profile files (e.g. `instances/*.env`) out of git — the `.gitignore` already excludes
`.env` and `instances/`.

### Statelessness guarantees

- No record, schema, or token caching — every tool call hits the instance fresh.
- Basic Auth header is computed per request; response cookies are ignored (no cookie jar),
  so no ServiceNow session is retained between calls.
- The write gate re-reads your current update set from the instance on every write.

If a metadata cache (e.g. table schemas) ever becomes worth it, it should be explicit,
on-disk, and per-instance — never implicit in-process memory.

## Tools

Read tools (always registered):

| Tool                                | Description                                                             |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `servicenow_query_records`          | Query a table with an encoded query; paginated (`hasMore`/`nextOffset`) |
| `servicenow_get_record`             | Fetch one record by sys_id                                              |
| `servicenow_get_aggregate`          | Stats API: count/avg/sum/min/max, optionally grouped                    |
| `servicenow_get_table_schema`       | Field list from `sys_dictionary`, including inherited fields            |
| `servicenow_get_current_update_set` | Show your current update set                                            |

Write tools (only when `SN_MCP_ALLOW_WRITES=true`):

| Tool                                | Description                                                 |
| ----------------------------------- | ----------------------------------------------------------- |
| `servicenow_create_record`          | Create a record (gated)                                     |
| `servicenow_update_record`          | Update a record (gated)                                     |
| `servicenow_delete_record`          | Delete a record (gated, requires `confirm: true`)           |
| `servicenow_set_current_update_set` | Switch your current update set (how you move off "Default") |

### The write gate

Every write first resolves your current update set on the instance
(`sys_user_preference` → `sys_update_set`). If it is "Default", the write is refused with a
clear error telling you to switch sets first. This keeps AI-driven changes tracked in a real
update set, the same discipline you'd apply by hand. Disable with
`SN_MCP_REQUIRE_UPDATE_SET=false` (e.g. for non-development instances).

## Development

```bash
npm run dev          # run from source (tsx)
npm test             # unit + in-memory integration tests
npm run test:live    # live smoke tests (needs SN_* env or .env; read-only)
npm run inspect      # MCP Inspector against dist/index.js
npm run ci           # lint + build + test
```

## Known limitations

- **Basic Auth only (v1).** If your instance enforces SSO/MFA for API access, requests fail
  with a "possible SSO/MFA redirect" error. An OAuth or session-based `AuthStrategy` is the
  planned phase 2 (`src/client/auth.ts` is the single seam to extend).
- **Schema from `sys_dictionary`.** Portable to every instance (including PDIs), but virtual/
  computed fields may be missing compared to `/api/now/doc/table/schema`.
- **PDI hibernation.** Personal developer instances sleep after inactivity; wake yours in a
  browser before running live tests.
