# Design: Docs-Guided ServiceNow Tools

Adds four read/advisory tools (docs search, docs get, best practices, precheck) plus an
opt-in strict-mode gate that requires a signed precheck token before risky writes — all
without new dependencies, without server-side state, and without changing default write
behavior.

## Quick path

1. `src/docs/token.ts` mints/verifies a compact HMAC-SHA256 token (base64url, `node:crypto`,
   in-memory per-process secret) binding `table + operation`.
2. `src/docs/precheck.ts` maps `(table, operation)` → risk level + matched best-practice
   entries via pattern rules, and issues a token when risk is `medium`/`high`.
3. `src/tools/docs.ts` registers the 4 new tools; `src/gate.ts` gains
   `assertPrecheckToken(cfg, params)`, called after `assertWritable` in write handlers,
   only enforced when `SN_MCP_REQUIRE_DOCS_PRECHECK=true`.
4. Verify: `npm run ci` green, new tools present in
   `test/integration/server.inmemory.test.ts` READ_TOOLS/WRITE_TOOLS arrays, strict-mode
   test proves writes are blocked without a valid token and unblocked with one.

## Architecture overview

```
src/
  docs/
    token.ts          # sign()/verify() — HMAC-SHA256, base64url, node:crypto
    precheck.ts        # analyzePrecheck(table, operation) -> { riskLevel, matches, token? }
    llmsIndex.ts        # fetchLlmsIndex(release) + parseLlmsIndex() + searchLlmsIndex()
    fetchDoc.ts          # fetchDocByPath(release, path) -> raw markdown + attribution
    bestPractices/
      index.ts          # BEST_PRACTICES: BestPracticeEntry[] (typed, in-repo authored)
      updateSets.ts
      recordOps.ts
      contracts.ts
      codingStandards.ts
  tools/
    docs.ts             # registerDocsTools(server, client, cfg)
  gate.ts                # + assertPrecheckToken(cfg, params)
  config.ts              # + requireDocsPrecheck, docsRelease
```

All docs/precheck modules are pure and stateless: no module-level cache, no singleton
index. Every call to `servicenow_docs_search`/`servicenow_docs_get` performs a fresh
`fetch` against `raw.githubusercontent.com`. This matches the existing `SnClient`
pattern (`FetchFn = typeof globalThis.fetch`, injected for tests) and the repo's "no
hidden state" hard rule (AGENTS.md rule 3).

## Data flow: docs-first workflow

```
Agent                    MCP Server                          GitHub raw / in-repo data
  |                          |                                        |
  |--servicenow_docs_search->|--fetch llms.txt (per release)--------->|
  |                          |<--markdown text------------------------|
  |                          |--parse + keyword score-->results
  |<--search results---------|
  |                          |
  |--servicenow_docs_precheck(table, op)-->|
  |                          |--match best-practice rules (in-repo, no I/O)
  |                          |--derive riskLevel
  |                          |--if risk >= medium: sign token (HMAC, exp ~10 min)
  |<--report + token----------|
  |                          |
  |--servicenow_create_record(..., precheckToken)-->|
  |                          |--assertWritable() [existing gate]
  |                          |--assertPrecheckToken() [new gate, only if strict mode]
  |                          |    verify signature, exp, table+operation match
  |                          |--proceed to SnClient write
  |<--result-------------------|
```

Advisory mode (default, `SN_MCP_REQUIRE_DOCS_PRECHECK=false`): `precheckToken` is accepted
but never required; `assertPrecheckToken` is not called. Strict mode: `assertPrecheckToken`
runs after `assertWritable` and throws `SnApiError(409)` if the token is missing, expired,
mismatched, or invalid.

## Decisions (ADR-style)

### 1. Token scheme

- **Decision**: Custom compact token, not JWT. Format:
  `base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)`.
- **Payload**: `{ table: string, operation: 'create'|'update'|'delete', riskLevel: 'low'|'medium'|'high', iat: number, exp: number }` (unix seconds).
- **Signing**: `node:crypto` `createHmac('sha256', secret)`; `secret = crypto.randomBytes(32)`
  generated once at process start (module-level constant in `token.ts`, not exported).
- **Validity window**: 10 minutes (`exp = iat + 600`).
- **Rejected alternative**: pulling in a JWT library (`jsonwebtoken`) — violates the
  "exactly two runtime deps" rule for no functional gain; JWT's header/alg-negotiation
  surface is unneeded complexity for a single-algorithm, single-process token.
- **Tradeoff accepted**: the secret lives only in process memory, so tokens issued by one
  server process are rejected by another (e.g. after a restart, or in a multi-instance
  deployment behind a load balancer). This is acceptable because: (a) the project is
  explicitly "one server process per ServiceNow instance" (AGENTS.md), (b) the token's
  purpose is a short-lived, same-session confirmation, not a durable credential, and
  (c) it avoids introducing any persisted secret file or env-var secret management ---
  consistent with the stateless-server rule. Document this in the tool description and
  in `AGENTS.md`.

### 2. llms.txt parsing

- **Decision**: fetch `https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/{release}/llms.txt`
  on every `servicenow_docs_search` call — no caching, no index persisted across calls.
- **Parsing**: llms.txt (per the [llms.txt spec](https://llmstxt.org)) is a flat markdown
  document with an H1 title, a blockquote summary, and H2 sections each containing a
  bullet list of `[Title](relative/path.md): optional description` links. Parse with
  line-based regex (`^##\s+(.+)$` for sections, `^-\s+\[(.+?)\]\((.+?)\)(?::\s*(.+))?$`
  for entries) — no markdown AST library needed (keeps zero-new-deps rule).
- **Search/scoring**: case-insensitive substring match against title + description +
  section name; score = number of query keywords matched, tie-broken by earliest
  position. Return top N (default 10) as `{ title, path, section, snippet }`.
- **Rejected alternative**: in-memory cache of the parsed index keyed by release. Rejected
  because it is the one piece of state that would violate the "no hidden state" rule and
  would go stale without a server restart; re-fetching a single small text file per call
  is cheap enough (llms.txt is typically tens of KB) that caching is not worth the
  statefulness tradeoff.

### 3. Network failure behavior

- **Decision**: docs tools (`servicenow_docs_search`, `servicenow_docs_get`) catch fetch
  errors, non-2xx responses, and timeouts, and return a structured `isError: true` result
  via a new lightweight helper (parallel to `toToolErrorResult`, since these aren't
  `SnApiError`s) with:
  - human-readable text: `"Could not reach ServiceNow docs (<reason>). Try servicenow_best_practices for curated offline guidance instead."`
  - `structuredContent: { error: { status: 0 | httpStatus, message } }`
  - never throws unhandled out of the tool handler.
- `servicenow_best_practices` never performs network I/O (pure in-repo data), so it has no
  failure mode beyond programmer error.
- `servicenow_docs_precheck` never performs network I/O either — it only reads in-repo
  best-practice data and signs a token — so strict-mode write gating is never blocked by
  network availability. This satisfies the proposal's non-goal: "never block writes in
  advisory mode" and, by construction, strict mode also never depends on live network.

### 4. Curated content format

- **Decision**: TypeScript data modules, not markdown + frontmatter.
  `src/docs/bestPractices/*.ts` each export an array of:
  ```ts
  interface BestPracticeEntry {
    id: string; // stable slug, e.g. "update-set-default-forbidden"
    area: 'update-sets' | 'record-ops' | 'contracts' | 'coding-standards';
    title: string;
    guidance: string; // markdown-formatted prose, 1-3 paragraphs
    appliesTo: {
      tables?: string[]; // exact names or glob-like prefixes, e.g. "sys_*"
      operations?: ('create' | 'update' | 'delete')[];
    };
    riskLevel: 'low' | 'medium' | 'high'; // baseline risk this entry represents
    citations?: { title: string; path: string }[]; // links into ServiceNowDocs llms.txt tree
  }
  ```
  `index.ts` re-exports `BEST_PRACTICES: BestPracticeEntry[]` (flattened from per-area files).
- **Rationale**: markdown+frontmatter would need a parser (new dep, or hand-rolled
  frontmatter splitting) and loses type checking; a `.md` file also cannot be `import`ed
  directly under Node ESM without a loader or `fs.readFileSync` + path resolution relative
  to `dist/`, which is fragile after `tsc` compiles to `dist/`. A typed TS module is
  type-checked at build time, tree-shakeable, needs zero runtime file I/O, and matches the
  project's existing "everything is TypeScript, no runtime asset loading" shape (contrast
  with e.g. `src/client/`, `src/tools/` which are pure `.ts`).
- **Rejected alternative**: markdown files with frontmatter parsed at runtime — adds a
  dependency or hand-rolled YAML-ish parser, adds a runtime `fs` read (breaks "stateless,
  no I/O beyond the configured ServiceNow instance" spirit for what is static content),
  and loses compile-time validation of `appliesTo`/`riskLevel` enums.

### 5. Token binding granularity

- **Decision**: exact match, normalized. `assertPrecheckToken` compares
  `token.table.toLowerCase() === params.table.toLowerCase()` and
  `token.operation === params.operation` (operation is derived from which write tool
  called the gate — `create`/`update`/`delete` — not user-supplied).
- `servicenow_delete_record` always requires a precheck token bound to `operation: 'delete'`
  specifically in strict mode — a token issued for `create`/`update` on the same table is
  rejected. Rationale: delete is irreversible; matching only on table would let an agent
  reuse a low-risk "create" precheck to justify a delete.
- **Rejected alternative**: wildcard/looser table matching (e.g. token issued for `sys_*`
  covers any `sys_` table). Rejected because it weakens the guarantee that a human/agent
  actually looked at guidance for the _specific_ table being written, and table-prefix
  matching is already how `analyzePrecheck` derives risk level (see #6) — reusing it for
  token binding would make the token nearly meaningless as a per-operation confirmation.

### 6. Best-practice matching for precheck

- **Decision**: `analyzePrecheck(table, operation)` runs ordered pattern rules against the
  table name to derive a `riskLevel`, then filters `BEST_PRACTICES` whose `appliesTo`
  matches:
  | Rule (checked in order)                                                                                       | Risk level                                                 |
  | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
  | `operation === 'delete'`                                                                                      | at least `medium` (escalate if table rule below is `high`) |
  | table matches `/^sys_/i` (platform/system tables)                                                             | `high`                                                     |
  | table matches `/^cmdb_/i` (CMDB)                                                                              | `high`                                                     |
  | table is a task-family table (`task`, `incident`, `problem`, `change_request`, `sc_task`, or ends in `_task`) | `medium`                                                   |
  | table has a custom prefix (`u_`, `x_`)                                                                        | `low`                                                      |
  | no rule matches                                                                                               | `low`                                                      |
- A best-practice entry matches if `appliesTo.tables` is unset (applies to all tables) or
  contains an exact/prefix match for the table, AND `appliesTo.operations` is unset or
  includes the operation.
- Report returned by `servicenow_docs_precheck` includes: `riskLevel`, matched entries
  (`id`, `title`, `guidance`, `citations`), and — only when `riskLevel !== 'low'` — a
  signed `precheckToken`. Low-risk operations do not get a token because strict mode never
  requires one for them (see gate logic below); this keeps low-friction ops fast.
- **Gate logic**: `assertPrecheckToken` requires a token only when the _computed_ risk for
  the actual write attempt is `medium` or `high`, OR the operation is `delete` (always).
  Low-risk creates/updates proceed without a token even in strict mode. This is
  recomputed server-side at write time (not trusted from client input) by calling the
  same `analyzePrecheck` risk derivation.

### 7. Gate integration

- `src/gate.ts` adds:
  ```ts
  export function assertPrecheckToken(
    cfg: Config,
    params: { table: string; operation: 'create' | 'update' | 'delete'; precheckToken?: string },
  ): void;
  ```
  Called synchronously (no I/O) in each write handler, immediately after
  `await assertWritable(client, cfg)`, before the `SnClient` call:
  ```ts
  const updateSet = await assertWritable(client, cfg);
  assertPrecheckToken(cfg, {
    table: args.table,
    operation: 'create',
    precheckToken: args.precheckToken,
  });
  ```
  Throws `SnApiError({ status: 409, message: ... })` on: missing token when required,
  expired token, signature mismatch, table/operation mismatch — mirroring the existing
  `assertWritable` throw style so `toToolErrorResult` renders it identically.
- No-op (returns immediately) when `cfg.requireDocsPrecheck === false` — zero behavior
  change in default/advisory mode, satisfying the proposal's success criterion.
- `src/config.ts` adds two fields following the existing `parseBool`/`parsePositiveInt`/
  `ConfigError` aggregation pattern:
  ```ts
  requireDocsPrecheck: boolean; // SN_MCP_REQUIRE_DOCS_PRECHECK, default false
  docsRelease: string; // SN_MCP_DOCS_RELEASE, default "australia"
  ```
  `docsRelease` has no strict validation beyond non-empty (branch names are free-form);
  invalid/nonexistent branches surface as a network 404 from the docs tools, handled per
  decision #3 (not a config-time failure, since we don't want to hit the network during
  config load — config loading must stay synchronous and offline).

### 8. Module layout

Matches "one module per domain, `register*Tools(server, client, cfg)`" (AGENTS.md
architecture map):

```
src/docs/token.ts            sign(payload) / verify(token) -> Result
src/docs/precheck.ts         analyzePrecheck(table, operation) -> PrecheckReport
src/docs/llmsIndex.ts        fetchLlmsIndex(release, fetchFn) / parseLlmsIndex() / searchLlmsIndex()
src/docs/fetchDoc.ts         fetchDocByPath(release, path, fetchFn) -> { markdown, sourceUrl }
src/docs/bestPractices/*.ts  BEST_PRACTICES data
src/tools/docs.ts            registerDocsTools(server, client, cfg)
```

`llmsIndex.ts` and `fetchDoc.ts` accept an injectable `fetchFn: typeof globalThis.fetch`
parameter (default `globalThis.fetch`), mirroring `SnClient`'s constructor pattern, so
unit tests can inject a fake fetch with zero network access — no new test infrastructure
needed.

`docs.ts` is registered unconditionally in `buildServer` (read-only tools, always
available, independent of `cfg.allowWrites`):

```ts
registerDocsTools(server, client, cfg); // after registerSchemaTools, before write-tools block
```

Write-tool handlers in `records.ts` (and `updateSet.ts`'s `servicenow_set_current_update_set`
if applicable) gain the optional `precheckToken` zod field and the `assertPrecheckToken`
call.

### 9. Doc release resolution

- **Default**: `SN_MCP_DOCS_RELEASE=australia` (current ServiceNow release-family default
  branch, per proposal's resolved facts).
- **Discovery**: `servicenow_docs_search`'s tool description documents that the release
  branch corresponds to a ServiceNow release family (e.g. `australia`, `beijing`) and
  points users at `https://github.com/ServiceNow/ServiceNowDocs/branches` to see available
  branches. No runtime branch-listing tool is added (would require an extra GitHub API
  call per session start — out of scope, adds complexity for a rarely-changed setting).
- Users on a different release update one env var; no code change required.

## Error handling table

| Scenario                                            | Tool(s)                                         | Behavior                                                                                                |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GitHub raw fetch network error / timeout            | `servicenow_docs_search`, `servicenow_docs_get` | `isError: true`, message suggests `servicenow_best_practices` fallback                                  |
| GitHub raw fetch 404 (bad release or path)          | `servicenow_docs_get`                           | `isError: true`, message includes attempted URL and release                                             |
| Malformed/unexpected llms.txt shape                 | `servicenow_docs_search`                        | Parser is tolerant (skips unmatched lines); empty result set is a valid (non-error) outcome with a note |
| Invalid table/operation combo (precheck)            | `servicenow_docs_precheck`                      | Not an error — returns `riskLevel: 'low'`, empty matches                                                |
| Missing precheck token, strict mode, risk >= medium | write tools                                     | `SnApiError(409)` via `assertPrecheckToken`, before any ServiceNow API call                             |
| Expired / tampered / mismatched-table token         | write tools                                     | `SnApiError(409)`, message states which check failed (expired vs. signature vs. binding)                |
| Advisory mode (default), any token state            | write tools                                     | No gate check performed; write proceeds as today                                                        |

## Testing strategy

- **Unit** (`test/unit/`, injected fake `fetch`, matching `SnClient` pattern):
  - `token.test.ts`: sign/verify round-trip, expiry, tampered payload/signature rejected,
    table/operation mismatch rejected.
  - `precheck.test.ts`: risk-level derivation table (sys__, cmdb__, task-family, custom
    prefix, delete escalation), best-practice matching filters correctly per area/table.
  - `llmsIndex.test.ts`: parses a fixture llms.txt string (no network), scoring/ranking,
    empty-result and malformed-line tolerance.
  - `fetchDoc.test.ts`: injected fetch returns markdown → passthrough with attribution;
    injected fetch throws/404 → structured error shape (unit-level, not full tool wiring).
  - `gate.test.ts` (extend existing): `assertPrecheckToken` no-op when
    `requireDocsPrecheck=false`; throws appropriately per each failure mode when true.
  - `config.test.ts` (extend existing): new env vars parsed with correct defaults and
    `ConfigError` aggregation.
- **Integration** (`test/integration/server.inmemory.test.ts`):
  - Add `servicenow_docs_search`, `servicenow_docs_get`, `servicenow_best_practices`,
    `servicenow_docs_precheck` to `READ_TOOLS`.
  - New test: strict mode (`SN_MCP_REQUIRE_DOCS_PRECHECK=true`) rejects
    `servicenow_create_record` on a `sys_*` table without `precheckToken`, succeeds with a
    valid one obtained from a prior `servicenow_docs_precheck` call in the same test.
  - New test: advisory mode (default) — write succeeds with no `precheckToken` supplied,
    proving zero behavior change.
  - Mocked `SnClient` extended only where write tools are exercised; docs tools do not
    touch `SnClient` at all (they take `client` for signature symmetry per
    `register*Tools(server, client, cfg)` but do not call it — confirm this is acceptable
    or drop the parameter for `docs.ts` if unused, to avoid an unused-parameter lint
    finding).

## Tradeoffs summary

| Decision                              | Tradeoff accepted                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-process HMAC secret               | Tokens don't survive server restart or work across multiple processes — acceptable for single-instance-per-process deployment model                                                     |
| No llms.txt caching                   | Slightly higher latency per docs search (one extra fetch) — acceptable given stateless-server hard rule and small file size                                                             |
| TypeScript data modules over markdown | Editing best-practice content requires a code change/PR (not a content-only markdown edit) — acceptable given the "authored and versioned in this repo" intent and stronger type safety |
| Exact table+operation token binding   | More precheck calls needed if an agent works across many tables — acceptable since `servicenow_docs_precheck` has no I/O cost and is cheap to call repeatedly                           |
| No branch-discovery tool              | Users must know ServiceNow release-family branch names externally — acceptable, documented in tool description and design                                                               |

## Checklist

- [x] `src/docs/token.ts`, `precheck.ts`, `llmsIndex.ts`, `fetchDoc.ts`,
      `bestPractices/*.ts` created per module layout above.
- [x] `src/tools/docs.ts` registers all 4 tools; wired into `buildServer` unconditionally.
- [x] `src/gate.ts` exports `assertPrecheckToken`; called in all 3 write handlers after
      `assertWritable`.
- [x] `src/config.ts` adds `requireDocsPrecheck` and `docsRelease` following existing
      parse/aggregate pattern.
- [x] `test/integration/server.inmemory.test.ts` arrays updated; strict-mode block/allow
      tests added.
- [x] No new npm dependency added (`package.json` unchanged beyond version bump if any).

## Next step

Proceed to `sdd-tasks` to break this design into an ordered, reviewable task list.
