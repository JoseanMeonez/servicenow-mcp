# Tasks: Docs-Guided ServiceNow Tools

Delivery: **single-pr** with `size:exception` pre-approved. All work units below land in
one PR. Each task is still an independently reviewable/revertable commit (work-unit
commits — code, its tests, and relevant docs together).

Legend: `[P]` = can run in parallel with sibling `[P]` tasks (no shared file, no
dependency). Unmarked tasks are sequential and depend on the task(s) immediately above
unless stated otherwise.

## 1. Config foundation

- [x] 1.1 Add `requireDocsPrecheck` (bool, default `false`, `SN_MCP_REQUIRE_DOCS_PRECHECK`)
      and `docsRelease` (string, default `"australia"`, `SN_MCP_DOCS_RELEASE`, non-empty
      validation only) to `src/config.ts`, following the existing `parseBool` /
      aggregated-`problems` pattern. - Write/extend `test/unit/config.test.ts` first (or alongside): defaults when
      unset, explicit values parsed, `ConfigError` on invalid bool. - Satisfies: docs-tools "Release Branch Configuration"; write-tools "Strict Mode
      Token Gating" (config flag that enables it). - Commit: `feat(config): add docs-precheck and docs-release env vars`

## 2. Token module (no dependents yet other than gate/precheck)

- [x] 2.1 `[P]` Create `src/docs/token.ts`: `sign(payload)` / `verify(token)` using
      `node:crypto` HMAC-SHA256, base64url encoding, module-level random secret
      (`crypto.randomBytes(32)`, not exported), 10-minute expiry window per design ADR #1. - Write `test/unit/docs/token.test.ts` first: sign/verify round-trip, expiry
      rejected, tampered payload rejected, tampered signature rejected. - Satisfies: docs-precheck "Precheck Token Issuance", "Precheck Statelessness". - Commit: `feat(docs): add HMAC precheck token sign/verify`

## 3. Best-practice curated data (parallel with token module)

- [x] 3.1 `[P]` Create `src/docs/bestPractices/contracts.ts`,
      `codingStandards.ts`, `recordOps.ts`, `updateSets.ts` — typed
      `BestPracticeEntry[]` per design ADR #4 (`id`, `area`, `title`, `guidance`,
      `appliesTo`, `riskLevel`, optional `citations`).
- [x] 3.2 Create `src/docs/bestPractices/index.ts` exporting flattened
      `BEST_PRACTICES: BestPracticeEntry[]`. - Write `test/unit/docs/bestPractices.test.ts`: each area has at least one entry,
      `riskLevel` and `area` values are within the typed enums, `index.ts` flattens all
      four modules. - Satisfies: docs-tools "Best Practices Tool" (data backing). - Commit: `feat(docs): add curated best-practice content modules`

## 4. Precheck risk engine (depends on 3, independent of 2 until token issuance)

- [x] 4.1 Create `src/docs/precheck.ts`: `analyzePrecheck(table, operation)` implementing
      the ordered risk-rule table from design ADR #6 (delete escalation, `sys_*`,
      `cmdb_*`, task-family, custom-prefix, default low) and best-practice matching by
      `appliesTo.tables` / `appliesTo.operations`. - Write `test/unit/docs/precheck.test.ts` first: one case per risk rule row, entry
      matching by table/operation, low-risk fallback returns curated best practices
      with no error. - Satisfies: docs-precheck "Precheck Report Generation". - Commit: `feat(docs): add precheck risk analysis and best-practice matching`
- [x] 4.2 Wire `token.ts` into `precheck.ts`: issue a signed token only when
      `riskLevel !== 'low'`, bound to `table` + `operation`. - Extend `test/unit/docs/precheck.test.ts`: token present for medium/high risk,
      absent for low risk, token payload matches table/operation. - Satisfies: docs-precheck "Precheck Token Issuance" (report-level wiring). - Commit: `feat(docs): issue precheck token from risk report`

## 5. llms.txt search + doc fetch (parallel with 4, independent modules)

- [x] 5.1 `[P]` Create `src/docs/llmsIndex.ts`: `fetchLlmsIndex(release, fetchFn)`,
      `parseLlmsIndex(text)` (line-based regex per design ADR #2),
      `searchLlmsIndex(index, query)` (substring scoring, top-N, tolerant of malformed
      lines). - Write `test/unit/docs/llmsIndex.test.ts` first: parses a fixture llms.txt string
      (no network), scoring/ranking order, empty-result case, malformed-line
      tolerance, injected fake `fetchFn` used instead of real `fetch`. - Satisfies: docs-tools "Docs Search Tool", "Tool Statelessness". - Commit: `feat(docs): add llms.txt fetch, parse, and search`
- [x] 5.2 `[P]` Create `src/docs/fetchDoc.ts`: `fetchDocByPath(release, path, fetchFn)` ->
      `{ markdown, sourceUrl }`, plus a lightweight non-`SnApiError` error helper for
      docs-tool failures (design ADR #3: network error, timeout, non-2xx, 404 all
      produce a structured error, never an unhandled throw). - Write `test/unit/docs/fetchDoc.test.ts` first: injected fetch returns markdown ->
      passthrough with attribution (source repo + branch); injected fetch
      throws/404/non-2xx -> structured error shape, no unhandled exception. - Satisfies: docs-tools "Docs Get Tool", "Docs Network Failure Handling",
      "License Attribution on Quoted Content". - Commit: `feat(docs): add doc-by-path fetch with attribution and error handling`

## 6. Gate integration (depends on 1, 2)

- [x] 6.1 Add `assertPrecheckToken(cfg, params)` to `src/gate.ts`: no-op when
      `cfg.requireDocsPrecheck === false`; when `true`, recompute risk via
      `analyzePrecheck` (server-side, not trusted from client) and require a valid,
      unexpired, matching token when risk is `medium`/`high` or operation is `delete`;
      throw `SnApiError(409)` per failure mode (missing / expired / signature mismatch /
      table-operation mismatch), matching `assertWritable`'s throw style. - Extend `test/unit/gate.test.ts` first: no-op in advisory mode; each strict-mode
      failure mode throws with a distinguishing message; valid matching token passes
      through. - Satisfies: write-tools "Strict Mode Token Gating", "Strict Mode Valid Token
      Passthrough". - Commit: `feat(gate): add assertPrecheckToken strict-mode gate`

## 7. Tool registration (depends on 3, 4, 5)

- [x] 7.1 Create `src/tools/docs.ts`: `registerDocsTools(server, client, cfg)` registering
      `servicenow_docs_search`, `servicenow_docs_get`, `servicenow_best_practices`,
      `servicenow_docs_precheck` as read-only tools (`annotations: { readOnlyHint: true }`),
      each wrapping its module call in `try/catch` returning the appropriate structured
      error result on failure (never throwing out of the handler). - Satisfies: docs-tools "Docs Search Tool", "Docs Get Tool", "Best Practices
      Tool"; docs-precheck "Precheck Report Generation", "Precheck Read-Only
      Registration". - Commit: `feat(tools): register docs search/get/best-practices/precheck tools`
- [x] 7.2 Export `registerDocsTools` from `src/tools/index.ts` and call it
      unconditionally in `src/server.ts` (`buildServer`), after
      `registerSchemaTools`/`registerUpdateSetReadTools` and before the
      `cfg.allowWrites` write-tool block — independent of `cfg.allowWrites`. - Satisfies: docs-precheck "Precheck Read-Only Registration" (available with
      writes disabled). - Commit: `feat(server): wire docs tools into buildServer unconditionally`

## 8. Write-tool wiring (depends on 6, 7)

- [x] 8.1 Add optional `precheckToken` zod field to the input schemas of
      `servicenow_create_record`, `servicenow_update_record`, `servicenow_delete_record`
      (`src/tools/records.ts`) and `servicenow_set_current_update_set`
      (`src/tools/updateSet.ts`), without changing any existing required parameter.
- [x] 8.2 Call `assertPrecheckToken(cfg, { table, operation, precheckToken })`
      immediately after `assertWritable(...)` in each of the four write handlers, with
      `operation` derived from which handler is running (`'create' | 'update' |
    'delete'`) — never user-supplied. - Satisfies: write-tools "Optional Precheck Token Parameter", "Advisory Mode
      Preserves Existing Behavior", "Strict Mode Token Gating", "Strict Mode Valid
      Token Passthrough". - Commit: `feat(records,updateSet): wire precheckToken through write handlers`

## 9. Integration test updates (depends on 7, 8)

- [x] 9.1 Update `test/integration/server.inmemory.test.ts`: add
      `servicenow_docs_search`, `servicenow_docs_get`, `servicenow_best_practices`,
      `servicenow_docs_precheck` to `READ_TOOLS`.
- [x] 9.2 Add new test: strict mode (`SN_MCP_REQUIRE_DOCS_PRECHECK=true`) rejects
      `servicenow_create_record` on a `sys_*` table without `precheckToken`; succeeds
      when given a valid token obtained from a prior in-test
      `servicenow_docs_precheck` call.
- [x] 9.3 Add new test: advisory mode (default) — write succeeds with no
      `precheckToken` supplied, proving zero behavior change from this feature. - Satisfies: write-tools "Advisory Mode Preserves Existing Behavior"; ties together
      all docs-tools/docs-precheck requirements at the tool-registration level. - Commit: `test(integration): cover docs tools and strict-mode precheck gating`

## 10. Docs and final verification (depends on all above)

- [x] 10.1 Update `README.md`: document `SN_MCP_REQUIRE_DOCS_PRECHECK`,
      `SN_MCP_DOCS_RELEASE` env vars and the four new tools (purpose, read-only status,
      advisory-vs-strict-mode behavior).
- [x] 10.2 Update `AGENTS.md` if it enumerates tools/env vars, to include the four new
      tools and two new env vars, keeping the architecture map accurate. - Commit: `docs: document docs-guided tools and precheck env vars`
- [x] 10.3 Run `npm test` (`vitest run test/unit test/integration`) — all unit and
      integration tests green, including new `docs/*` unit suites and updated
      integration suite.
- [x] 10.4 Run lint/typecheck (per `AGENTS.md`/`package.json` scripts, e.g. `npm run
    lint` and `npm run build` or `tsc --noEmit`) — zero errors.
- [x] 10.5 Manual/live smoke check: with network access, call `servicenow_docs_search`
      and `servicenow_docs_get` against the real `australia` branch of
      `ServiceNow/ServiceNowDocs` to confirm the live-fetch path (not just the injected
      fake-fetch unit tests) returns real content; confirm `servicenow_docs_get` on a
      bad path returns a structured "not found" error, not an unhandled exception. - Commit (if any fixes needed): `fix(docs): <describe live-fetch fix>` — otherwise
      no commit, just a verification note in the PR description.

## Review Workload Forecast

- Estimated changed lines: **~950–1150** across ~14 new files (`src/docs/token.ts`,
  `src/docs/precheck.ts`, `src/docs/llmsIndex.ts`, `src/docs/fetchDoc.ts`,
  `src/docs/bestPractices/{index,updateSets,recordOps,contracts,codingStandards}.ts`,
  `src/tools/docs.ts`, ~6 new unit test files) plus edits to 6 existing files
  (`src/config.ts`, `src/gate.ts`, `src/tools/index.ts`, `src/server.ts`,
  `src/tools/records.ts`, `src/tools/updateSet.ts`,
  `test/integration/server.inmemory.test.ts`, `README.md`, `AGENTS.md`).
- Chained PRs recommended: **No** — `delivery_strategy: single-pr` with `size:exception`
  pre-approved by the user for this change.
- 400-line budget risk: **High** (estimate is roughly 2.5–3x the 400-line guideline),
  but this is the accepted, user-approved exception, not an open decision.
- Decision needed before apply: **No** — exception already recorded here per the
  `single-pr` delivery strategy. Work-unit commits (per `work-unit-commits` skill) keep
  the single PR reviewable unit-by-unit even though it exceeds 400 lines overall.
