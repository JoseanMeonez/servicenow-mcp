# Design: SSO Session Authentication

Adds a second `AuthStrategy` that reuses a browser session created through SSO, selected by
`SN_AUTH_MODE=session`, with credentials read from an on-disk file on every request — no new
dependency, no in-memory session, no change to default behavior.

## Quick path

1. `src/config.ts` gains `authMode` (`basic` | `session`, default `basic`) and `sessionFile`;
   `SN_PASSWORD` becomes conditional, `SN_USERNAME` stays required in both modes.
2. `src/client/auth.ts` gains `sessionAuth` (reads and validates the session file, returns
   `Cookie` + `X-UserToken`) and `authFor(cfg)` (mode → strategy).
3. `src/client/snClient.ts` resolves auth once per request _outside_ the retry `try`, and
   renders 401 / non-JSON diagnostics per mode.
4. Verify: `npm run ci` green, plus a live end-to-end run in `session` mode with no
   `SN_PASSWORD` set.

## Architecture overview

```
src/
  config.ts        # + authMode, sessionFile; per-mode required-variable rules
  client/
    auth.ts        # basicAuth | sessionAuth, authFor(cfg), readSessionFile()
    snClient.ts    # auth resolved per request; nonJsonMessage()/unauthorizedHint() per mode
```

`SnClient` is unchanged in shape: it still receives an `AuthStrategy` and never learns which
mode is active for the purpose of building requests. Only the two diagnostic helpers read
`cfg.authMode`, and only to phrase an error.

## Data flow

```
Browser (already logged in through SSO)
  |
  |  user copies Cookie + X-UserToken from DevTools -> Network -> Request Headers
  v
SN_SESSION_FILE  {"cookie": "...", "userToken": "..."}
  |
  |  read on EVERY request (readFileSync)
  v
sessionAuth(cfg) --> { Cookie, X-UserToken } --> SnClient.request() --> instance
```

## Decisions (ADR-style)

### 1. Session reuse, not OAuth

- **Decision**: authenticate by replaying the user's SSO web session.
- **Rationale**: every inbound OAuth 2.0 flow in ServiceNow — authorization code, client
  credentials, JWT bearer — posts to `/oauth_token.do` and requires a `client_id` created
  under _System OAuth → Application Registry_. There is no public client and no bypass, and
  creating one requires instance-admin rights the target user does not have.
- **Rejected alternative**: inbound REST API Keys (`com.glide.tokenbased_auth`, Washington+).
  These need no Application Registry entry and never expire, but authenticate an integration
  user rather than the SSO user, and still require configuring an Inbound Authentication
  Profile on the instance. Documented in the README as an alternative for users whose real
  need is credential-free access rather than their own identity.

### 2. `X-UserToken` is a required credential, not a write-only CSRF token

- **Decision**: `userToken` is mandatory in the session file; both headers go on every
  request.
- **Evidence** — same authenticated session, three variants of one `GET /api/now/table/sys_user`
  against a live instance:

  | Headers sent             | Result                                         |
  | ------------------------ | ---------------------------------------------- |
  | `Cookie` only            | `401 User is not authenticated`                |
  | `X-UserToken` only       | `401 User is not authenticated`                |
  | `Cookie` + `X-UserToken` | `200 {"result":[{"user_name":"survey.user"}]}` |

- **Why it matters**: community guidance widely describes `g_ck` as CSRF protection needed
  only for `POST`/`PATCH`/`DELETE`. That is wrong for the Table API. Treating `userToken` as
  optional would have shipped a mode where every read fails with an opaque 401.
- **Consequence**: validation rejects a file missing either field, naming which one, before
  any HTTP request — a config error the user can act on, instead of a 401 they cannot.

### 3. A file, not environment variables

- **Decision**: credentials live in a JSON file at `SN_SESSION_FILE`, re-read per request.
- **Rationale**: an MCP server's environment is fixed at spawn time by the client's
  `.mcp.json`. Putting a session in env vars means editing that file and restarting the
  server every ~30 minutes, in every MCP client that has it registered. A file the process
  re-reads turns recovery into a paste.
- **Statelessness**: AGENTS.md rule 3 forbids hidden state and permits an exception that is
  "explicit, on-disk, per-instance, and opt-in". This is exactly that shape — and it is
  weaker than a cache, since nothing is retained between calls.
- **Rejected alternative**: read once at startup. Cheaper per request, but reintroduces the
  restart it exists to avoid.
- **Tradeoff accepted**: one synchronous `readFileSync` of a few hundred bytes precedes each
  HTTP round trip. If that ever registers, the upgrade path is an mtime-keyed cache, not a
  startup read.

### 4. Session capture stays manual

- **Decision**: the user copies `Cookie` and `X-UserToken` from DevTools → Network → Request
  Headers of any XHR to the instance.
- **Rationale**: `JSESSIONID` is served `HttpOnly` (`glide.cookies.http_only`), so
  `document.cookie` cannot read it — a console snippet or bookmarklet cannot capture the
  session no matter how it is written. Both values appear together on the same request in the
  Network panel, which makes that the one place where a single copy yields a consistent pair.
- **Rejected alternatives**: driving a headless browser (Playwright) or decrypting the OS
  cookie store (DPAPI on Windows, plus Chrome's app-bound encryption). Each is a large
  dependency or platform-specific native work, for ergonomics rather than capability, against
  a repo rule of exactly two runtime dependencies.

### 5. `SN_USERNAME` remains required in session mode

- **Decision**: keep it required in both modes.
- **Rationale**: `src/gate.ts` resolves the current update set through
  `sys_user.user_name = cfg.username`. The session identifies the user to ServiceNow but not
  to this process.
- **Rejected alternative**: derive the user from the session via `/api/now/ui/user/current_user`.
  It works — it returned the expected user during verification — but it is an undocumented
  UI-internal endpoint and adds a round trip to every write, to replace one env var the user
  already knows.

### 6. Auth resolution moved out of the retry loop

- **Decision**: call the strategy once per `request()`, before the `for` retry loop and
  outside its `try`.
- **Rationale**: previously `this.auth(this.cfg)` was evaluated inside the `try` wrapping
  `fetch`. With Basic Auth it cannot throw, so this was harmless. With `sessionAuth` it can
  throw on a missing or malformed file, and that would have been caught by the `catch` and
  re-labelled `Network error on GET …` — a misleading message for a local configuration
  problem. Hoisting it also avoids re-reading the file on each retry attempt of one request.

### 7. Mode-aware diagnostics

- **Decision**: `unauthorizedHint()` and `nonJsonMessage()` branch on `cfg.authMode`.
- **Rationale**: the existing 401 hint tells the user to grant `snc_basic_auth_api_access` and
  set `internal_integration_user` — advice that is not merely useless in session mode but
  actively misleading, since the failure is almost always an expired session. Likewise, the
  non-JSON message "possible SSO/MFA redirect instead of Basic Auth" describes the diagnosis
  in session mode rather than the cause; there it means the session died.
- Both session-mode messages name the configured session file path, and never its contents.

## Error handling table

| Scenario                            | Behavior                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Session file missing / unreadable   | `SnApiError(status 0)` naming the path + expected format; no HTTP call |
| Session file not valid JSON         | `SnApiError(status 0)` naming the path + expected format; no HTTP call |
| `cookie` and/or `userToken` empty   | `SnApiError(status 0)` naming which field(s); no HTTP call, no retry   |
| 401 from the instance, session mode | Existing detail + hint pointing at the session file, not at Basic Auth |
| Non-JSON body, session mode         | "the SSO session has most likely expired", naming the session file     |
| 401 / non-JSON, basic mode          | Unchanged from before this capability                                  |
| Invalid `SN_AUTH_MODE`              | `ConfigError`, aggregated with any other config problems               |

## Testing strategy

- **Unit** (`test/unit/auth.test.ts`, new — real temp files via `mkdtempSync`, no network):
  strategy selection per mode; headers produced; whitespace trimmed; hot reload (write, read,
  overwrite, read again); rejection of a missing file, invalid JSON, and each incomplete-field
  combination with the field named in the message.
- **Unit** (`test/unit/config.test.ts`): default mode; session mode without a password;
  `SN_SESSION_FILE` required in session mode; `SN_USERNAME` required in session mode; unknown
  mode rejected.
- **Unit** (`test/unit/snClient.test.ts`): 401 hint is session-flavored and does _not_ mention
  `snc_basic_auth_api_access`; non-JSON body reads as an expired session; a throwing auth
  strategy surfaces as-is with `fetch` never called.
- **Live** (manual, not committed): against a real instance, a session captured through form
  login drives the built `SnClient` in session mode with no `SN_PASSWORD` — `queryTable` and
  `getTableSchema` (91 fields, multiple requests) succeed, a stale session yields the 401 hint,
  restoring the file works in the same process, and an incomplete file fails before the wire.

## Tradeoffs summary

| Decision                     | Tradeoff accepted                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Session reuse over OAuth     | Sessions expire (~30 min idle) and cannot be refreshed headlessly                              |
| Manual capture               | A periodic copy-paste from DevTools; unavoidable while `JSESSIONID` is `HttpOnly`              |
| File re-read per request     | One small synchronous local read per HTTP call, in exchange for never restarting the server    |
| `userToken` required         | Slightly stricter than some instances may need, in exchange for a clear error over a blind 401 |
| `SN_USERNAME` still required | One redundant-looking variable, in exchange for no extra request and no undocumented endpoint  |

## Checklist

- [x] `src/config.ts`: `authMode`, `sessionFile`, per-mode validation via the existing
      aggregated-`problems` pattern.
- [x] `src/client/auth.ts`: `sessionAuth`, `authFor`, `SESSION_FILE_FORMAT`, strict two-field
      validation.
- [x] `src/client/snClient.ts`: auth hoisted out of the retry `try`; `nonJsonMessage()` and
      `unauthorizedHint()` branch on mode.
- [x] Tests: `auth.test.ts` added; `config.test.ts` and `snClient.test.ts` extended.
- [x] Docs: README "SSO session mode" (capture workflow, OAuth constraint, API-key
      alternative), AGENTS.md architecture map + rules, `.env.example`, `.gitignore`.
- [x] No new npm dependency.

## Next step

Archived with the implementation; `openspec/specs/session-auth/spec.md` carries the merged
requirements.
