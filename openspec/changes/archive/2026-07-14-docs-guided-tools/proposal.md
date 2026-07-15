# Proposal: Docs-Guided ServiceNow Tools

## Intent

ServiceNow operations (record writes, update-set changes) carry non-obvious risk: wrong scoping, missing required fields, journal-field misuse, or edits on risky tables (`sys_*`, `task`, `cmdb`) can silently break contracts or introduce technical debt. Today the MCP server executes writes with no guidance layer — an agent (or its human operator) has no built-in way to consult ServiceNow best practices or official docs before acting. This proposal adds docs/best-practice awareness directly into the tool surface, and an opt-in enforcement mode that requires a precheck before risky writes.

## Scope

### In Scope
- `servicenow_docs_search` — search the `llms.txt` index of the official `ServiceNow/ServiceNowDocs` repo.
- `servicenow_docs_get` — fetch full markdown of a specific doc topic (live fetch, per configured release branch).
- `servicenow_best_practices` — query curated, authored-in-repo guidance by area (update sets, record ops, contracts, coding standards).
- `servicenow_docs_precheck` — analyze an intended operation, return a structured report (risk level, applicable best practices, doc citations, suggested steps), and issue a signed precheck token when relevant.
- New config: `SN_MCP_REQUIRE_DOCS_PRECHECK` (default `false`) and `SN_MCP_DOCS_RELEASE` (default: latest release branch).
- Optional `precheckToken` parameter on write tools (create/update/delete record, set current update set); enforced only in strict mode via `assertWritable`-style gate.
- Curated best-practice content authored in-repo (not copied from ServiceNow docs) covering: update-set discipline, record operations, contracts/breaking changes, coding standards.

### Out of Scope
- Full documentation mirroring/redistribution of ServiceNow docs (live-fetch only).
- Automatic enforcement without opt-in (`SN_MCP_REQUIRE_DOCS_PRECHECK=false` is default; no behavior change out of the box).
- Any server-side session/cache state (violates statelessness rule).
- Non-v1 best-practice areas (e.g., workflow/flow designer, integrations) — deferred.

## Capabilities

### New Capabilities
- `docs-tools`: read-only tools for searching/fetching official ServiceNow docs and querying embedded best-practice content.
- `docs-precheck`: structured risk-analysis tool for intended write operations, issuing an optional signed token.

### Modified Capabilities
- `write-tools`: add optional `precheckToken` parameter and strict-mode gate check (only enforced when `SN_MCP_REQUIRE_DOCS_PRECHECK=true`); no change to default behavior or existing signatures' required fields.

## Approach

Hybrid docs strategy: curated best-practice markdown authored and versioned in this repo (zero licensing risk, works offline) + live HTTP fetch against the official `ServiceNow/ServiceNowDocs` GitHub repo for deeper reference lookups (no bundling, no redistribution). Precheck issues a self-contained HMAC-signed token (~10 min validity, bound to table + operation type) — consistent with the stateless-server rule since no server-side session is kept. Enforcement is advisory by default; strict mode is opt-in per instance via env var, extending the existing `assertWritable` gate pattern in `src/gate.ts`.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `src/tools/docs.ts` (new) | New | `servicenow_docs_search`, `servicenow_docs_get`, `servicenow_best_practices`, `servicenow_docs_precheck` |
| `src/best-practices/*.md` (new) | New | Curated, authored-in-repo guidance content |
| `src/gate.ts` | Modified | Extend/parallel gate for strict-mode precheck-token validation |
| `src/config.ts` | Modified | Add `SN_MCP_REQUIRE_DOCS_PRECHECK`, `SN_MCP_DOCS_RELEASE` env parsing |
| `src/server.ts` | Modified | Register new docs tools via `registerDocsTools` |
| `src/tools/records.ts`, `updateSet.ts` | Modified | Optional `precheckToken` param on write handlers |
| `test/unit`, `test/integration/server.inmemory.test.ts` | Modified | Add new tools to READ_TOOLS/WRITE_TOOLS arrays; add precheck/token tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| Licensing of ServiceNowDocs content | Low | Live-fetch only, no redistribution; curated content is authored in-repo |
| Network dependency for docs tools | Med | Docs tools are read-only/advisory; failures return clear errors, never block writes in advisory mode |
| Strict mode gives false sense of security | Med | Precheck report is advisory content, not a guarantee; document limitations clearly |
| Token secret management (per-process HMAC) | Low | No cross-process/server-side state; secret generated at process start, consistent with statelessness rule |
| Test surface growth breaks existing hardcoded tool arrays | High | Explicit task to update `test/integration/server.inmemory.test.ts` arrays |
| PR size exceeds 400-line budget | High (accepted) | `size:exception` pre-approved by user for single PR |

## Rollback Plan

All new tools are additive and independently registered (`registerDocsTools`); reverting is a single-file removal from `src/server.ts` registration plus deleting `src/tools/docs.ts` and `src/best-practices/`. No schema/data migrations. Strict mode is opt-in via env var — unsetting it fully restores prior write-tool behavior with zero code changes required.

## Dependencies

- Network access to `raw.githubusercontent.com` for live doc fetch (no new npm dependency; use built-in `fetch`).
- Confirm license terms of `ServiceNow/ServiceNowDocs` permit fetching/quoting excerpts at runtime (not redistribution) — verify during design phase.

## Success Criteria

- [x] New docs/precheck tools are registered and pass integration tests without touching existing tool behavior.
- [x] Default behavior (advisory mode) produces zero breaking changes to existing write tool signatures.
- [x] Strict mode blocks writes without a valid precheck token when `SN_MCP_REQUIRE_DOCS_PRECHECK=true`, verified by a dedicated test.
- [x] Curated best-practice content covers all 4 v1 areas (update sets, record ops, contracts, coding standards).

## Open Questions for Design Phase

1. **Token signing details**: exact JWT-like payload shape (claims: table, operation, exp, iat), HMAC algorithm (HS256?), secret generation/rotation strategy per process start.
2. **llms.txt parsing strategy**: format assumptions, whether to cache the index in-memory per-call (stateless — no persistent cache) or re-fetch every search.
3. **Network failure behavior**: should `servicenow_docs_search`/`get` fail hard, return a structured "unavailable" response, or fall back to curated content only?
4. **Curated content format**: single markdown file per area vs. structured directory with frontmatter metadata for `servicenow_best_practices` filtering.
5. **Precheck token binding granularity**: exact match on table+operation, or looser matching (e.g., wildcard tables, field-level scope)?
