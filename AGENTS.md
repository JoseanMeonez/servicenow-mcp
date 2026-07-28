# AGENTS.md — operating guide for AI agents

Single source of truth for every agent working in this repository. Read this before
changing anything.

## What this project is

A standalone MCP server (stdio) exposing the ServiceNow Table, Aggregate, and schema APIs
as tools, with an in-process update-set write gate. TypeScript ESM, `@modelcontextprotocol/sdk`
1.x, zod, Vitest. It is instance-agnostic: one server process per ServiceNow instance.

## Architecture map

| Path                          | Responsibility                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                | stdio entry: load env → config → client → server. Fatal errors to stderr, exit 1                                                               |
| `src/config.ts`               | Env parsing. Fail fast with ALL problems aggregated in one `ConfigError`                                                                       |
| `src/errors.ts`               | `SnApiError` + `toToolErrorResult()` — the only place tool error results are shaped                                                            |
| `src/client/auth.ts`          | `AuthStrategy` = function returning headers: `basicAuth` and `sessionAuth` (SSO session file), picked by `authFor(cfg)`. Extend here for OAuth |
| `src/client/snClient.ts`      | REST client: retry (429/5xx, Retry-After), pagination (Link/X-Total-Count), timeout, error normalization, schema hierarchy walk                |
| `src/gate.ts`                 | `getCurrentUpdateSet` / `assertWritable` / `setCurrentUpdateSet` / `assertPrecheckToken` — the write gate                                      |
| `src/docs/token.ts`           | HMAC-SHA256 precheck token sign/verify (`node:crypto`, per-process secret, ~10 min TTL)                                                        |
| `src/docs/precheck.ts`        | `analyzePrecheck(table, operation)` — risk rules + best-practice matching + token issuance                                                     |
| `src/docs/llmsIndex.ts`       | Fetch/parse/search the `ServiceNow/ServiceNowDocs` `llms.txt` index (injectable `fetchFn`)                                                     |
| `src/docs/fetchDoc.ts`        | Fetch a single doc's markdown by path, with attribution and structured errors (injectable `fetchFn`)                                           |
| `src/docs/bestPractices/*.ts` | Curated, authored-in-repo best-practice content (`BEST_PRACTICES: BestPracticeEntry[]`)                                                        |
| `src/tools/*.ts`              | One module per domain; each exports `register*Tools(server, client, cfg)`                                                                      |
| `src/server.ts`               | `buildServer(cfg, client)`: read tools always; write tools ONLY when `cfg.allowWrites`                                                         |
| `test/unit/`                  | Unit tests with injected fake `fetch` (no network)                                                                                             |
| `test/integration/`           | Real MCP client ↔ server over `InMemoryTransport`, mocked `SnClient`                                                                           |
| `test/live/`                  | Env-gated smoke tests against a real instance; never mutate data                                                                               |

## Hard rules (non-negotiable)

1. **stdout is the MCP protocol channel.** Nothing in `src/` may write to stdout —
   no `console.log`, no `process.stdout.write`. Diagnostics go to `process.stderr.write`.
   ESLint enforces `no-console` on `src/**`.
2. **Write safety is layered and layers stay in order.** (a) Write tools are registered only
   when `SN_MCP_ALLOW_WRITES=true`; (b) every write handler calls `assertWritable()` first,
   which refuses while the current update set is "Default"; (c) `assertPrecheckToken()` runs
   immediately after `assertWritable()` — a no-op unless `SN_MCP_REQUIRE_DOCS_PRECHECK=true`,
   in which case it requires a valid, unexpired, table/operation-matching token for
   medium/high-risk writes and all deletes. Never remove, reorder, or short-circuit any layer.
   `servicenow_delete_record` keeps `confirm: z.literal(true)`.
3. **No hidden state.** The server holds no caches, no sessions, no cross-call memory.
   If a cache is ever justified, it must be explicit, on-disk, per-instance, and opt-in.
4. **Credentials never enter git or code.** They live in `.env` / `instances/*.env` /
   `SN_SESSION_FILE` (all gitignored) or the MCP client's `env` block. Never interpolate
   passwords, cookies, or `g_ck` tokens into errors, logs, or test fixtures — error hints
   name the _path_ of the session file, never its contents. Quote passwords containing
   `#`, `;`, or spaces.
5. **Every tool result follows the convention**: human-readable `content` text +
   `structuredContent`; failures go through `toToolErrorResult()` (`isError: true`).
   Do not hand-roll error shapes in tool handlers.
6. **Tests accompany behavior.** New client behavior → unit test with injected fetch.
   New/changed tool → integration test over `InMemoryTransport`. Live tests must be
   read-only or gate-blocked writes, and skip cleanly without env.

## Standards

- TypeScript strict, ESM with `NodeNext` — relative imports use the `.js` extension.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). No AI attribution
  or Co-Authored-By lines in commits.
- Formatting via Prettier, linting via ESLint flat config. Run `npm run format` before
  committing.
- Node >= 20.6 (`process.loadEnvFile`). CI = `npm run ci` (lint + build + unit/integration).
- Keep the ladder: prefer stdlib/platform features over new dependencies. The project has
  exactly two runtime deps (`@modelcontextprotocol/sdk`, `zod`) — keep it that way unless
  there is a strong reason.

## Commands

| Command             | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Run from source (tsx)                                    |
| `npm run build`     | Compile to `dist/`                                       |
| `npm test`          | Unit + integration tests (no network)                    |
| `npm run test:live` | Live smoke tests — needs `SN_*` env or `.env`; read-only |
| `npm run inspect`   | MCP Inspector against `dist/index.js`                    |
| `npm run ci`        | lint + build + test — must be green before any commit    |

## Connecting an instance (checklist)

With `SN_AUTH_MODE=basic` (default), for every new instance/user the API user must have:

1. Roles: `snc_basic_auth_api_access` (mandatory for Basic Auth REST) + data-access roles
   (least privilege at work; `admin` acceptable on a personal dev instance).
2. `internal_integration_user = true` on the `sys_user` record.
3. A dedicated integration user (e.g. `api.tester`) — never a personal account.

Symptom when missing: `401 "User is not authenticated"` with correct credentials.
The client appends this hint to every 401 automatically.

With `SN_AUTH_MODE=session` none of the above applies: the request carries the user's own
SSO web session, read from `SN_SESSION_FILE` on every request. `Cookie` **and**
`X-UserToken` (g_ck) are both mandatory on every call, reads included — verified live:
either one alone answers `401 User is not authenticated`. There is no OAuth path — inbound
OAuth needs an Application Registry entry. See README, "SSO session mode".

Multi-instance: one `.mcp.json` entry per instance using Node's native flag —
`node --env-file=instances/<name>.env dist/index.js`. See README "Multiple instances".

## Knowledge graph (graphify)

This repo has a knowledge graph at `graphify-out/` (local artifact, not committed).

- For codebase questions, run `graphify query "<question>"` first when
  `graphify-out/graph.json` exists; use `graphify path "<A>" "<B>"` for relationships
  and `graphify explain "<concept>"` for focused concepts.
- After modifying code, run `graphify update .` to keep the graph current (AST-only,
  no API cost).
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.

## Verification before claiming done

1. `npm run ci` green.
2. If tool behavior changed: `npm run test:live` against a dev instance (wake the PDI
   first — it hibernates).
3. If tool registration changed: verify with MCP Inspector (`npm run inspect`) that the
   read/write tool split still matches `SN_MCP_ALLOW_WRITES`.
