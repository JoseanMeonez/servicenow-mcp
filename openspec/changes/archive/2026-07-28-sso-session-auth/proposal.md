# Proposal: SSO Session Authentication

## Intent

The server authenticates with Basic Auth only. Many corporate ServiceNow instances disable
Basic Auth on the REST API and force SSO, which leaves this MCP server unusable there: the
instance answers an HTML identity-provider redirect instead of JSON, and the client can only
report "possible SSO/MFA redirect".

The obvious fix — OAuth — is not available to every user. Every inbound OAuth 2.0 flow in
ServiceNow (authorization code, client credentials, JWT bearer) authenticates against
`/oauth_token.do`, which requires a `client_id` registered under _System OAuth → Application
Registry_. There is no public client and no bypass, and creating a registry entry needs
instance-admin rights that a typical user does not have.

This change adds a second authentication mode that reuses the web session the user's browser
already established through SSO, so requests run as that user — their identity, their roles,
their ACLs — with nothing to configure on the instance.

## Scope

### In Scope

- New `SN_AUTH_MODE` env var: `basic` (default, unchanged) or `session`.
- New `sessionAuth` strategy reading `cookie` + `userToken` (g_ck) from a JSON file pointed at
  by `SN_SESSION_FILE`, re-read on every request.
- Config validation per mode: `SN_PASSWORD` required only in `basic`; `SN_SESSION_FILE`
  required only in `session`; `SN_USERNAME` required in both.
- Mode-aware diagnostics: 401 hints and non-JSON-response messages that name the actual
  failure (expired session) instead of the Basic Auth role checklist.
- Auth resolution moved out of the retry loop so a malformed session file surfaces as a
  configuration error rather than a retried "network error".
- Documentation of the capture workflow and of the OAuth/Application Registry constraint.

### Out of Scope

- **OAuth of any grant type.** Blocked by the Application Registry requirement; `AuthStrategy`
  remains the seam for users who do have a registry entry.
- **Automatic session capture.** `JSESSIONID` is `HttpOnly` (`glide.cookies.http_only`), so no
  in-page script can read it. Automating capture requires either a headless browser
  (Playwright) or decrypting the OS cookie store (DPAPI on Windows) — both violate the
  two-runtime-dependency rule for an ergonomic gain, not a functional one.
- **Session renewal.** Refreshing an SSO session requires a browser round trip through the
  identity provider, possibly with MFA. Out of reach for a stdio server.
- **Inbound REST API Keys** (`com.glide.tokenbased_auth`, Washington+). A credential-free
  alternative that also avoids the Application Registry, but runs as an integration user
  rather than as the SSO user — a different capability, documented in the README as an
  alternative rather than implemented.
- **Any change to the write gate, update-set discipline, or precheck gate.**

## Capabilities

### New Capabilities

- `session-auth`: authenticate REST calls with a browser session established through SSO,
  selected by `SN_AUTH_MODE=session` and supplied by an on-disk session file.

### Modified Capabilities

None. Write tools, docs tools, and the precheck gate are untouched; `basic` remains the
default and behaves exactly as before.

## Approach

Extend the existing `AuthStrategy` seam (`src/client/auth.ts`) rather than branching the
client: `authFor(cfg)` picks `basicAuth` or `sessionAuth` from `cfg.authMode`, and `SnClient`
keeps calling one opaque header-producing function. The session file is read synchronously on
every request — the one deliberate piece of I/O in the hot path — because that is what lets a
user replace an expired session by pasting new values, with no MCP server restart. This is the
explicit, on-disk, per-instance, opt-in shape that AGENTS.md rule 3 permits as the exception to
"no hidden state"; nothing is retained in memory between calls.

## Affected Areas

| Area                                                   | Impact   | Description                                                                      |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------------------- |
| `src/client/auth.ts`                                   | Modified | Add `sessionAuth`, `authFor(cfg)`, session-file parsing and validation           |
| `src/config.ts`                                        | Modified | Add `authMode` + `sessionFile`; make `SN_PASSWORD` conditional                   |
| `src/client/snClient.ts`                               | Modified | Resolve auth once per request outside the retry `try`; mode-aware error messages |
| `test/unit/auth.test.ts`                               | New      | Session-file parsing, strategy selection, hot reload, rejection cases            |
| `test/unit/config.test.ts`                             | Modified | Per-mode required/optional variables                                             |
| `test/unit/snClient.test.ts`                           | Modified | Mode-aware 401/non-JSON hints; auth failure is not retried                       |
| `README.md`, `AGENTS.md`, `.env.example`, `.gitignore` | Modified | Capture workflow, OAuth constraint, ignore session files                         |

## Risks

| Risk                                                        | Likelihood | Mitigation                                                                                                   |
| ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Session expiry interrupts work mid-task                     | High       | Accepted and documented; hot reload keeps recovery to a paste, with no restart. Error message names the file |
| A session file is committed to git                          | Med        | `.gitignore` covers `.session.json` / `*.session.json`; AGENTS.md rule 4 extended to cookies and `g_ck`      |
| Users assume the cookie alone is enough (as forums claim)   | High       | Both fields validated as required, with a message naming the missing one; verified behavior documented       |
| Writes run as a real human user, not an integration account | Med        | Inherent to SSO mode and the point of it; the update-set write gate is unchanged and still applies           |
| A stale session is mistaken for a permissions problem       | Med        | 401 hint and non-JSON message are mode-aware and point at the session file rather than at Basic Auth roles   |

## Rollback Plan

Fully additive. `SN_AUTH_MODE` defaults to `basic`, so an installation that sets nothing
behaves exactly as before. Reverting means deleting `sessionAuth`/`authFor` from
`src/client/auth.ts`, restoring `basicAuth` as the `SnClient` constructor default, and dropping
two config fields. No data, schema, or protocol migration.

## Dependencies

None. `node:fs` and `node:crypto` are stdlib; no npm dependency added. Requires the user to
have browser access to the instance to capture a session.

## Success Criteria

- [x] `SN_AUTH_MODE=session` authenticates read and write calls against a live instance with
      no `SN_PASSWORD` set.
- [x] Default configuration (`SN_AUTH_MODE` unset) is byte-for-byte unchanged in behavior.
- [x] An expired session is replaceable mid-process, verified in one running process.
- [x] An incomplete session file fails before any HTTP request, naming the missing field.
- [x] `npm run ci` green.
