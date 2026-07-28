# session-auth Specification

## Purpose

Enables the MCP server to authenticate against ServiceNow instances that block Basic Auth and
enforce SSO, by reusing a web session the user established in a browser — without an OAuth
Application Registry entry, and without retaining session state in memory.

## Requirements

### Requirement: Auth Mode Selection

The server MUST accept an `SN_AUTH_MODE` environment variable with the values `basic` or
`session`, defaulting to `basic` when unset or empty. Any other value MUST fail configuration
loading with a `ConfigError` naming the variable.

#### Scenario: Default mode is unchanged

- GIVEN `SN_AUTH_MODE` is not set
- WHEN configuration is loaded
- THEN the auth mode is `basic`
- AND requests carry an `Authorization: Basic` header exactly as before this capability existed

#### Scenario: Session mode selected

- GIVEN `SN_AUTH_MODE=session` and a valid `SN_SESSION_FILE`
- WHEN configuration is loaded
- THEN the auth mode is `session`
- AND the client uses the session strategy instead of Basic Auth

#### Scenario: Unknown mode rejected

- GIVEN `SN_AUTH_MODE=oauth`
- WHEN configuration is loaded
- THEN loading fails with a `ConfigError` mentioning `SN_AUTH_MODE`

### Requirement: Per-Mode Configuration Requirements

Configuration validation MUST require `SN_PASSWORD` only in `basic` mode and `SN_SESSION_FILE`
only in `session` mode. `SN_USERNAME` MUST be required in both modes, because the write gate
resolves the current update set by user name.

#### Scenario: Session mode without a password

- GIVEN `SN_AUTH_MODE=session`, `SN_USERNAME`, and `SN_SESSION_FILE` are set
- AND `SN_PASSWORD` is not set
- WHEN configuration is loaded
- THEN loading succeeds

#### Scenario: Session mode without a session file

- GIVEN `SN_AUTH_MODE=session` and no `SN_SESSION_FILE`
- WHEN configuration is loaded
- THEN loading fails with a `ConfigError` mentioning `SN_SESSION_FILE`

#### Scenario: Session mode without a user name

- GIVEN `SN_AUTH_MODE=session` and `SN_SESSION_FILE` set, but no `SN_USERNAME`
- WHEN configuration is loaded
- THEN loading fails with a `ConfigError` mentioning `SN_USERNAME`

### Requirement: Session Credentials Are Read From a File

In `session` mode the server MUST read credentials from the JSON file at `SN_SESSION_FILE`,
containing a `cookie` string (the browser's full `Cookie` header) and a `userToken` string
(the `g_ck` value). Both MUST be non-empty strings; surrounding whitespace MUST be trimmed.

#### Scenario: Valid session file

- GIVEN a session file containing a non-empty `cookie` and `userToken`
- WHEN a request is made
- THEN the request carries a `Cookie` header with the file's cookie value
- AND an `X-UserToken` header with the file's userToken value

#### Scenario: Session file missing a field

- GIVEN a session file containing only `cookie`
- WHEN a request is attempted
- THEN it fails before any HTTP call with an error naming the missing `"userToken"` value
- AND the error detail states the expected file format

#### Scenario: Session file unreadable or malformed

- GIVEN `SN_SESSION_FILE` points at a nonexistent file, or a file that is not valid JSON
- WHEN a request is attempted
- THEN it fails with an error naming the file path and the expected format

### Requirement: Both Headers Are Sent On Every Request

The server MUST send `Cookie` and `X-UserToken` together on every request in `session` mode,
including reads. ServiceNow rejects session-authenticated requests carrying only one of them
with `401 "User is not authenticated"` — this applies to `GET` as well as to writes, so
`userToken` is a required credential, not a write-only CSRF token.

#### Scenario: Read request in session mode

- GIVEN a valid session file
- WHEN a read tool such as `servicenow_query_records` is invoked
- THEN the outgoing request carries both `Cookie` and `X-UserToken`
- AND the instance returns records

#### Scenario: Write request in session mode

- GIVEN a valid session file and writes enabled with a named update set
- WHEN a write tool is invoked
- THEN the outgoing request carries both `Cookie` and `X-UserToken`
- AND the existing write gate and precheck gate apply unchanged

### Requirement: Session Replacement Without Restart

The session file MUST be re-read on every request, so that replacing an expired session takes
effect immediately in the running server process.

#### Scenario: Expired session replaced mid-process

- GIVEN a running server whose session has expired and whose requests fail with 401
- WHEN the user writes fresh `cookie` and `userToken` values into the same file
- THEN the next request succeeds
- AND no restart of the MCP server process is required

### Requirement: Mode-Aware Authentication Diagnostics

Authentication failures MUST be reported in terms of the active auth mode. In `session` mode a
401 MUST point at the session and its file path; a non-JSON response MUST be reported as a
likely expired session. In `basic` mode the existing instance-user-setup hint
(`snc_basic_auth_api_access`, `internal_integration_user`) MUST be preserved unchanged.

#### Scenario: 401 in session mode

- GIVEN `SN_AUTH_MODE=session`
- WHEN the instance answers 401
- THEN the error detail states the session has expired or the values are inconsistent
- AND names the configured session file
- AND does NOT mention `snc_basic_auth_api_access`

#### Scenario: HTML login page in session mode

- GIVEN `SN_AUTH_MODE=session`
- WHEN the instance answers with a non-JSON body (an identity-provider login page)
- THEN the error states the SSO session has most likely expired and names the session file

#### Scenario: 401 in basic mode

- GIVEN `SN_AUTH_MODE=basic`
- WHEN the instance answers 401
- THEN the error detail contains the existing instance-user-setup hint, unchanged

### Requirement: Credential Errors Are Not Retried Or Disguised

Resolving credentials MUST happen once per request, before the retry loop. A failure to
produce auth headers MUST propagate as its own error, MUST NOT be reported as a network error,
and MUST NOT trigger the 429/5xx retry logic.

#### Scenario: Broken session file during a request

- GIVEN a session file that cannot be parsed
- WHEN any tool issues a request
- THEN the original error is surfaced unchanged
- AND no HTTP request is sent
- AND no retry is attempted

### Requirement: Session Credentials Never Enter Logs Or Version Control

Cookie and `g_ck` values MUST NOT appear in error messages, structured error content, or test
fixtures; diagnostics MUST reference the session file by path only. Default session file names
MUST be excluded from version control.

#### Scenario: Error output after a failed session request

- GIVEN a request that fails in `session` mode
- WHEN the error is rendered as a tool result
- THEN it contains the session file path
- AND it contains no cookie or token value
