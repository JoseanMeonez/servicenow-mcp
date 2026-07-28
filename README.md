# servicenow-mcp

Standalone [MCP](https://modelcontextprotocol.io) server for ServiceNow. Exposes the Table,
Aggregate, and schema APIs as tools, with an **in-process update-set write gate**: write tools
are only registered when explicitly enabled, and every write is refused while your current
update set is "Default".

Works with Claude Code, Claude Desktop, Antigravity CLI, opencode, GitHub Copilot CLI,
GitHub Copilot in VS Code, and any other MCP client (stdio transport).

## Requirements

- Node.js >= 20.6
- A ServiceNow instance reachable with Basic Auth (username/password), **or** an instance you
  can log into through SSO in a browser — see [SSO session mode](#sso-session-mode)

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

| Variable                       | Default                   | Description                                                                                                              |
| ------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SN_BASE_URL`                  | — (required)              | Instance URL, e.g. `https://dev12345.service-now.com`                                                                    |
| `SN_AUTH_MODE`                 | `basic`                   | `basic` (username/password) or `session` ([SSO session mode](#sso-session-mode))                                         |
| `SN_USERNAME`                  | — (required)              | Your ServiceNow user name. Required in both modes: the write gate uses it to resolve whose update set is current         |
| `SN_PASSWORD`                  | — (required in `basic`)   | Basic Auth password. Unused in `session` mode                                                                            |
| `SN_SESSION_FILE`              | — (required in `session`) | Path to the JSON file holding the captured session                                                                       |
| `SN_MCP_ALLOW_WRITES`          | `false`                   | Register write tools (create/update/delete/set update set)                                                               |
| `SN_MCP_REQUIRE_UPDATE_SET`    | `true`                    | Refuse writes while the current update set is "Default"                                                                  |
| `SN_MCP_DEFAULT_LIMIT`         | `50`                      | Default query page size                                                                                                  |
| `SN_MCP_MAX_LIMIT`             | `500`                     | Hard ceiling on any requested limit                                                                                      |
| `SN_MCP_REQUEST_TIMEOUT_MS`    | `30000`                   | Per-request timeout                                                                                                      |
| `SN_MCP_RETRY_MAX_ATTEMPTS`    | `3`                       | Attempts for 429/5xx responses (honors `Retry-After`)                                                                    |
| `SN_MCP_REQUIRE_DOCS_PRECHECK` | `false`                   | Strict mode: require a valid `servicenow_docs_precheck` token before medium/high-risk or delete writes                   |
| `SN_MCP_DOCS_RELEASE`          | `australia`               | ServiceNow release branch used by the docs tools (see [branches](https://github.com/ServiceNow/ServiceNowDocs/branches)) |

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

## SSO session mode

For instances that block Basic Auth on the REST API and where you cannot create an OAuth
client, `SN_AUTH_MODE=session` reuses the web session your browser already established
through SSO. Requests then run as **you**: your identity, your roles, your ACLs.

> Why not OAuth? Every inbound OAuth 2.0 flow in ServiceNow — authorization code, client
> credentials, JWT bearer — authenticates against `/oauth_token.do`, which requires a
> `client_id` created under _System OAuth → Application Registry_. There is no public client
> and no bypass. Without a registry entry, reusing the SSO session is the only way to call the
> API as a real SSO user.

### Capturing the session

1. Open your instance in a browser and log in through SSO as usual.
2. Open DevTools → **Network**, and click any request to your instance (reload the page if the
   list is empty). Prefer an XHR call to `/api/…` — it carries both values you need.
3. From that request's **Request Headers**, copy both:
   - the full value of `Cookie`
   - the value of `X-UserToken` (the `g_ck` token). If the request has none, run `g_ck` in the
     DevTools **Console** instead — but take it from the same logged-in session.
4. Save both into the file you pointed `SN_SESSION_FILE` at:

```json
{
  "cookie": "JSESSIONID=1A2B3C...; glide_user_route=glide.abc...; glide_session_store=...",
  "userToken": "5f1e...c9"
}
```

**Both values are required on every request, reads included.** Verified against a live
instance: the cookie alone answers `401 User is not authenticated`, `X-UserToken` alone does
too, and only the pair returns data. They must come from the same browser session — the server
refuses to start a request if either is missing from the file.

The file is re-read on every request. When the session expires, paste fresh values and keep
working — **no server restart needed**. Keep it out of git; `.gitignore` already excludes
`.session.json` and `instances/`.

### What to expect

- **The session expires** (`glide.ui.session_timeout`, typically 30 minutes idle) and cannot be
  refreshed without a browser. You will re-capture it periodically. That is the cost of not
  having an OAuth client, not a bug.
- On expiry the instance answers with an HTML login page instead of JSON. The server reports
  it as `the SSO session has most likely expired` and names your session file.
- Logging out of the browser session invalidates the captured cookie immediately.

### Alternative: no SSO, no Application Registry

If what you actually need is credential-free access rather than _your_ identity, ServiceNow
(Washington+) supports inbound **REST API Keys**: activate `com.glide.tokenbased_auth`, create
an Inbound Authentication Profile under _System Web Services → API Access Policies_, and issue
a key. It never expires and needs no registry entry — but it runs as an integration user, not
as you. This server does not implement it; `src/client/auth.ts` is where it would go.

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

## Register with Antigravity CLI

Antigravity CLI's MCP config lives at `~/.gemini/antigravity-cli/mcp_config.json` (it shares
the Gemini CLI config layout, not `~/.antigravitycli`). Add under `mcpServers`:

```json
{
  "mcpServers": {
    "servicenow-dev": {
      "command": "node",
      "args": [
        "--env-file=C:/path/to/servicenow-mcp/instances/dev.env",
        "C:/path/to/servicenow-mcp/dist/index.js"
      ]
    }
  }
}
```

Start a new Antigravity CLI session afterward — config is only read at startup, an existing
session won't pick it up.

**Prompt to hand to Antigravity CLI** (or any agent with file-edit access) to do this for you:

> Add a new entry under `mcpServers` in `~/.gemini/antigravity-cli/mcp_config.json` named
> `servicenow-<instance>`, pointing to `node` with args
> `--env-file=<absolute path to instances/<instance>.env>` and
> `<absolute path to dist/index.js>`. Keep existing entries intact. Then tell me to start a
> new session for it to take effect.

## Register with opencode

Add under `mcp` in `~/.config/opencode/opencode.json` (or your project's `opencode.json`):

```json
{
  "mcp": {
    "servicenow-dev": {
      "enabled": true,
      "type": "local",
      "command": [
        "node",
        "--env-file=C:/path/to/servicenow-mcp/instances/dev.env",
        "C:/path/to/servicenow-mcp/dist/index.js"
      ]
    }
  }
}
```

Note the command and its args live together in a single array (unlike Claude's
`command`/`args` split).

**Prompt to hand to opencode:**

> Add a new entry under `mcp` in `~/.config/opencode/opencode.json` named
> `servicenow-<instance>`, with `"type": "local"`, `"enabled": true`, and `command` as an
> array: `["node", "--env-file=<absolute path to instances/<instance>.env>", "<absolute path
to dist/index.js>"]`. Keep existing entries intact.

## Register with GitHub Copilot CLI

Copilot CLI's config lives at `~/.copilot/mcp-config.json` (override via `COPILOT_HOME`).
Add under `mcpServers`, with an explicit `"type": "stdio"`:

```json
{
  "mcpServers": {
    "servicenow-dev": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=C:/path/to/servicenow-mcp/instances/dev.env",
        "C:/path/to/servicenow-mcp/dist/index.js"
      ],
      "env": {}
    }
  }
}
```

Or from the terminal: `copilot mcp add` (interactive), then verify with `/mcp show` inside a
Copilot CLI session.

**Prompt to hand to Copilot CLI:**

> Add a new entry under `mcpServers` in `~/.copilot/mcp-config.json` named
> `servicenow-<instance>`, with `"type": "stdio"`, `command: "node"`, and args
> `["--env-file=<absolute path to instances/<instance>.env>", "<absolute path to
dist/index.js>"]`. Keep existing entries intact. Then run `/mcp show` to confirm it loaded.

## Register with GitHub Copilot in VS Code

VS Code Copilot uses `.vscode/mcp.json` in the workspace (commit it to share with your team),
with the root key `servers` — **not** `mcpServers` like the other clients:

```json
{
  "servers": {
    "servicenow-dev": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=C:/path/to/servicenow-mcp/instances/dev.env",
        "C:/path/to/servicenow-mcp/dist/index.js"
      ]
    }
  }
}
```

Saving the file with valid JSON restarts the Copilot agent and reloads servers automatically
— no full VS Code restart needed.

**Prompt to hand to Copilot Chat in VS Code:**

> Create or update `.vscode/mcp.json` in this workspace: add an entry under `servers` (not
> `mcpServers`) named `servicenow-<instance>`, with `"type": "stdio"`, `command: "node"`, and
> args `["--env-file=<absolute path to instances/<instance>.env>", "<absolute path to
dist/index.js>"]`. Keep existing entries intact.

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
- Auth headers are computed per request; response cookies are ignored (no cookie jar), so no
  ServiceNow session is retained between calls. In `session` mode the credentials come from
  `SN_SESSION_FILE`, re-read on every request — explicit, on-disk, per-instance, opt-in, and
  never held in memory across calls.
- The write gate re-reads your current update set from the instance on every write.

If a metadata cache (e.g. table schemas) ever becomes worth it, it should be explicit,
on-disk, and per-instance — never implicit in-process memory.

## Tools

Read tools (always registered):

| Tool                                | Description                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `servicenow_query_records`          | Query a table with an encoded query; paginated (`hasMore`/`nextOffset`)                          |
| `servicenow_get_record`             | Fetch one record by sys_id                                                                       |
| `servicenow_get_aggregate`          | Stats API: count/avg/sum/min/max, optionally grouped                                             |
| `servicenow_get_table_schema`       | Field list from `sys_dictionary`, including inherited fields                                     |
| `servicenow_get_current_update_set` | Show your current update set                                                                     |
| `servicenow_docs_search`            | Search the `llms.txt` topic index of `ServiceNow/ServiceNowDocs`                                 |
| `servicenow_docs_get`               | Fetch the full markdown of a specific doc path                                                   |
| `servicenow_best_practices`         | Curated, in-repo guidance (update-sets, record-ops, contracts, coding standards); no network I/O |
| `servicenow_docs_precheck`          | Risk-analyze an intended write; issues a signed token for medium/high-risk or delete operations  |

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

### Docs-guided writes and the precheck gate

All four write tools also accept an optional `precheckToken` parameter, obtained by calling
`servicenow_docs_precheck` with the target `table` and `operation` (`create`/`update`/
`delete`) beforehand. The precheck report includes a risk level (`low`/`medium`/`high`),
matching curated best practices, and — for medium/high-risk operations, or any `delete` — a
signed token valid for approximately 10 minutes.

- **Advisory mode (default, `SN_MCP_REQUIRE_DOCS_PRECHECK=false`)**: the token is accepted
  but never required; writes behave exactly as before this feature existed.
- **Strict mode (`SN_MCP_REQUIRE_DOCS_PRECHECK=true`)**: a write whose _server-recomputed_
  risk is medium/high, or whose operation is `delete`, is refused unless a valid, unexpired
  `precheckToken` bound to that exact table and operation is supplied. Low-risk creates/
  updates still proceed without a token.

The token is a compact HMAC-SHA256-signed value, verified without any server-side session or
cache (fully self-contained), but signed with a secret generated fresh per process — tokens
from one server process are not valid against another (e.g. after a restart). This is
intentional: the token is a short-lived confirmation that guidance was consulted, not a
durable credential.

## Development

```bash
npm run dev          # run from source (tsx)
npm test             # unit + in-memory integration tests
npm run test:live    # live smoke tests (needs SN_* env or .env; read-only)
npm run inspect      # MCP Inspector against dist/index.js
npm run ci           # lint + build + test
```

## Known limitations

- **No OAuth.** Basic Auth and [SSO session mode](#sso-session-mode) only. OAuth would require
  an Application Registry entry on the instance; `src/client/auth.ts` is the single seam to
  extend if you have one.
- **SSO sessions expire and are captured by hand.** Roughly every 30 idle minutes, with no way
  to refresh them outside a browser.
- **Schema from `sys_dictionary`.** Portable to every instance (including PDIs), but virtual/
  computed fields may be missing compared to `/api/now/doc/table/schema`.
- **PDI hibernation.** Personal developer instances sleep after inactivity; wake yours in a
  browser before running live tests.
