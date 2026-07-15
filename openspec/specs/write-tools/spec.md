# write-tools Specification

## Purpose

Enables ServiceNow record and update-set mutations via the MCP server, with optional
docs-guided strict-mode gating that requires a valid precheck token before risky operations.

## Requirements

### Requirement: Optional Precheck Token Parameter

Each of the four write tools (`servicenow_create_record`, `servicenow_update_record`,
`servicenow_delete_record`, `servicenow_set_current_update_set`) MUST accept an
optional `precheckToken` parameter without changing any existing required parameter or
tool signature.

#### Scenario: Write tool called without precheckToken (default)

- GIVEN `SN_MCP_REQUIRE_DOCS_PRECHECK=false` (default)
- WHEN an agent calls `servicenow_create_record` without a `precheckToken`
- THEN the write proceeds exactly as before this change

#### Scenario: Write tool called with an extra precheckToken

- GIVEN `SN_MCP_REQUIRE_DOCS_PRECHECK=false` (default)
- WHEN an agent calls `servicenow_update_record` with a `precheckToken` present
- THEN the token is accepted as optional input and does not alter the write's outcome

### Requirement: Advisory Mode Preserves Existing Behavior

When `SN_MCP_REQUIRE_DOCS_PRECHECK` is `false` (the default), write tools MUST behave
identically to their pre-change behavior: no token is required, and the existing
`assertWritable` gate (write-enablement and update-set checks) is the only gate applied.

#### Scenario: Default configuration unchanged

- GIVEN a server started with default configuration (no `SN_MCP_REQUIRE_DOCS_PRECHECK` set)
- WHEN any write tool is called with valid existing parameters
- THEN the write succeeds or fails based only on pre-existing gate rules, unaffected
  by the docs-precheck feature

### Requirement: Strict Mode Token Gating

When `SN_MCP_REQUIRE_DOCS_PRECHECK=true`, write tools MUST reject the call with a clear
error if `precheckToken` is missing, expired, or does not match the table and
operation type being performed, in addition to existing gate checks.

#### Scenario: Missing token in strict mode

- GIVEN `SN_MCP_REQUIRE_DOCS_PRECHECK=true`
- WHEN an agent calls `servicenow_delete_record` without a `precheckToken`
- THEN the tool rejects the call with an error explaining a valid precheck token is required

#### Scenario: Expired token in strict mode

- GIVEN `SN_MCP_REQUIRE_DOCS_PRECHECK=true`
- AND a `precheckToken` issued more than ~10 minutes ago
- WHEN an agent calls `servicenow_update_record` with that token
- THEN the tool rejects the call with an error indicating the token has expired

#### Scenario: Mismatched token in strict mode

- GIVEN `SN_MCP_REQUIRE_DOCS_PRECHECK=true`
- AND a `precheckToken` issued for table `incident` and operation `update`
- WHEN an agent calls `servicenow_create_record` on table `problem` using that token
- THEN the tool rejects the call with an error indicating the token does not match the
  requested table or operation

### Requirement: Strict Mode Valid Token Passthrough

When `SN_MCP_REQUIRE_DOCS_PRECHECK=true` and a valid, unexpired, matching
`precheckToken` is supplied, the write tool MUST proceed to existing gate checks and
write logic exactly as in advisory mode.

#### Scenario: Valid matching token in strict mode

- GIVEN `SN_MCP_REQUIRE_DOCS_PRECHECK=true`
- AND a `precheckToken` issued for table `incident` and operation `update`, not yet expired
- WHEN an agent calls `servicenow_update_record` on table `incident` with that token
- THEN the precheck-token gate passes
- AND the existing `assertWritable` gate and write logic run unchanged
