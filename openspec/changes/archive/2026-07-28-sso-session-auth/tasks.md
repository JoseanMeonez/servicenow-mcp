# Tasks: SSO Session Authentication

Delivery: **single-pr**, landed as one commit. The change is ~200 lines across three source
files plus tests and docs, well inside the review budget, and session mode does not function
with any subset of it — config, strategy, and client wiring are one unit. The `Commit:` labels
below record the intended granularity of each work unit for review, not separate commits.

Legend: `[P]` = can run in parallel with sibling `[P]` tasks (no shared file, no dependency).
Unmarked tasks are sequential and depend on the task immediately above unless stated
otherwise.

## 1. Config foundation

- [x] 1.1 Add `authMode` (`'basic' | 'session'`, default `basic`, `SN_AUTH_MODE`) and
      `sessionFile` (string, `SN_SESSION_FILE`) to `src/config.ts` via a `parseAuthMode`
      helper following the existing `parseBool` / aggregated-`problems` pattern. Make
      `SN_PASSWORD` required only in `basic` mode and `SN_SESSION_FILE` required only in
      `session` mode; keep `SN_USERNAME` required in both, with a comment explaining that the
      write gate resolves the update set by user name. - Extend `test/unit/config.test.ts`: default mode, session mode without a password,
      missing `SN_SESSION_FILE`, missing `SN_USERNAME`, unknown mode rejected. - Satisfies: session-auth "Auth Mode Selection", "Per-Mode Configuration Requirements". - Commit: `feat(config): add SN_AUTH_MODE and SN_SESSION_FILE`

## 2. Session auth strategy

- [x] 2.1 Add `sessionAuth` and `authFor(cfg)` to `src/client/auth.ts`. `readSessionFile()`
      reads `SN_SESSION_FILE` with `readFileSync` on every call, parses JSON, requires
      non-empty `cookie` and `userToken` (naming whichever is missing), trims both, and throws
      `SnApiError({ status: 0 })` with `SESSION_FILE_FORMAT` as detail on any failure.
      Document why the file is re-read per request and what the upgrade path is. - Write `test/unit/auth.test.ts` first: strategy selection, headers produced, trimming,
      hot reload, missing file, invalid JSON, each incomplete-field case. - Satisfies: session-auth "Session Credentials Are Read From a File", "Both Headers Are
      Sent On Every Request", "Session Replacement Without Restart". - Commit: `feat(auth): add SSO session strategy reading cookie and g_ck from a file`

## 3. Client wiring and diagnostics

- [x] 3.1 In `src/client/snClient.ts`, default the constructor's strategy to `authFor(cfg)`
      and resolve `this.auth(this.cfg)` once per `request()`, before the retry loop and
      outside its `try`, so a broken session file is not re-labelled as a network error nor
      retried. - Extend `test/unit/snClient.test.ts`: a throwing auth strategy surfaces as-is and
      `fetch` is never called. - Satisfies: session-auth "Credential Errors Are Not Retried Or Disguised". - Commit: `fix(client): resolve auth outside the retry loop`

- [x] 3.2 Add `unauthorizedHint()` and `nonJsonMessage()` to `SnClient`, branching on
      `cfg.authMode`: session mode points at the session file and an expired session; basic
      mode keeps the existing `snc_basic_auth_api_access` / `internal_integration_user` hint
      verbatim. Never include credential values, only the file path. - Extend `test/unit/snClient.test.ts`: session-mode 401 detail mentions the session and
      not `snc_basic_auth_api_access`; a non-JSON body reads as an expired session. - Satisfies: session-auth "Mode-Aware Authentication Diagnostics", "Session Credentials
      Never Enter Logs Or Version Control". - Commit: `feat(client): make auth error hints mode-aware`

## 4. Live verification

- [x] 4.1 Verify against a real instance before documenting the contract: with one
      authenticated session, compare `Cookie` only, `X-UserToken` only, and both, on the same
      `GET`. Result: only the pair returns 200 — so `userToken` is required on reads too, and
      task 2.1's validation must reject a file that omits it. Then drive the built `SnClient`
      in session mode with no `SN_PASSWORD`: `queryTable`, `getTableSchema`, stale-session
      401, mid-process replacement, and an incomplete file failing before the wire. - Satisfies: session-auth "Both Headers Are Sent On Every Request" (empirically). - No commit — verification scripts are scratch, never committed.

## 5. Documentation

- [x] 5.1 `[P]` README: "SSO session mode" section — why OAuth is unavailable (Application
      Registry), the capture workflow, the session file format, both fields required on every
      request, expiry expectations, and the inbound REST API Key alternative. Update the
      requirements list, the configuration table, the statelessness guarantees, and the known
      limitations. - Commit: `docs(readme): document SSO session mode`

- [x] 5.2 `[P]` `AGENTS.md`: architecture map entry for `auth.ts`, rule 4 extended to cookies
      and `g_ck` tokens, and a session-mode paragraph in the instance checklist.
      `.env.example`: `SN_AUTH_MODE`, `SN_SESSION_FILE`, per-mode comments. `.gitignore`:
      `.session.json` and `*.session.json`. - Commit: `docs(agents): record session auth rules and ignore session files`

## 6. Verification

- [x] 6.1 `npm run ci` green (lint + build + 105 unit/integration tests).
- [x] 6.2 Confirm default behavior is untouched: with `SN_AUTH_MODE` unset, the Basic Auth
      header and both existing error hints are byte-for-byte as before.
