# docs-precheck Specification

## Purpose

A structured risk-analysis tool for intended ServiceNow write operations, combining
curated best-practice guidance and official doc citations, and optionally issuing a
signed token that write tools can validate in strict mode.

## Requirements

### Requirement: Precheck Report Generation

The system MUST expose `servicenow_docs_precheck`, a read-only tool that accepts an
intended operation description (table name, operation type, and optionally target
fields) and returns a structured report containing: risk level, applicable best
practices, official doc citations (when reachable), and suggested next steps.

#### Scenario: Precheck on a risky table

- WHEN an agent calls `servicenow_docs_precheck` for a `create` operation on `sys_dictionary`
- THEN the report's risk level reflects the elevated risk of a `sys_*` table
- AND the report includes applicable best practices for record operations and contracts

#### Scenario: Precheck on a low-risk table

- WHEN an agent calls `servicenow_docs_precheck` for a `create` operation on a custom
  application table not matching risky patterns (`sys_*`, `task`, `cmdb`)
- THEN the report's risk level reflects lower risk
- AND the report still includes applicable general best practices

### Requirement: Precheck Token Issuance

When a precheck completes, the system MUST issue an HMAC-signed, self-contained token
bound to the target table and operation type, valid for approximately 10 minutes, and
include it in the report response.

#### Scenario: Token issued alongside the report

- WHEN `servicenow_docs_precheck` completes for `update` on table `incident`
- THEN the response includes a signed token bound to `table=incident` and `operation=update`
- AND the token's validity window is approximately 10 minutes from issuance

### Requirement: Precheck Statelessness

Token issuance and validation MUST NOT rely on server-side session or cache state; all
data needed to validate a token MUST be self-contained within the token itself.

#### Scenario: Token remains valid across process-independent validation

- GIVEN a token issued by one precheck call
- WHEN a subsequent write tool call validates that token
- THEN validation succeeds using only the token's own signed payload, without querying
  any in-memory session store

### Requirement: Precheck Read-Only Registration

`servicenow_docs_precheck` MUST be registered unconditionally as a read-only tool,
independent of `SN_MCP_REQUIRE_DOCS_PRECHECK` or `SN_MCP_ALLOW_WRITES` settings.

#### Scenario: Precheck available with writes disabled

- GIVEN `SN_MCP_ALLOW_WRITES=false`
- WHEN an agent calls `servicenow_docs_precheck`
- THEN the tool returns a report normally (precheck itself performs no write)

### Requirement: Precheck Degrades on Docs Network Failure

If the live ServiceNow docs fetch fails during a precheck, the tool MUST still return a
report based on curated best-practice content and MUST clearly indicate that doc
citations were unavailable, rather than failing the whole request.

#### Scenario: Docs source unreachable during precheck

- GIVEN `raw.githubusercontent.com` is unreachable
- WHEN an agent calls `servicenow_docs_precheck`
- THEN the report is still returned with risk level and curated best practices
- AND the report indicates that official doc citations could not be retrieved
