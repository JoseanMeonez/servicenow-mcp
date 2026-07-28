import { readFileSync } from 'node:fs';
import type { Config } from '../config.js';
import { SnApiError } from '../errors.js';

/**
 * An auth strategy returns the HTTP headers that authenticate a request.
 * `basicAuth` sends username/password; `sessionAuth` reuses a ServiceNow web
 * session established through SSO. Both are pure functions of the config —
 * the client itself holds no credentials and no session state.
 */
export type AuthStrategy = (cfg: Config) => Record<string, string>;

export const basicAuth: AuthStrategy = (cfg) => ({
  Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`,
});

export const SESSION_FILE_FORMAT =
  'Expected JSON: {"cookie": "JSESSIONID=...; glide_user_route=...", "userToken": "<g_ck>"}. ' +
  'Both values are required — see README, "SSO session mode".';

interface SessionCredentials {
  cookie: string;
  userToken: string;
}

/**
 * Reuses a browser session created by SSO, for instances where Basic Auth is
 * blocked and no OAuth Application Registry entry can be created.
 *
 * Both headers are mandatory, on reads as much as on writes: verified against
 * a live instance, `Cookie` alone answers 401 "User is not authenticated" and
 * `X-UserToken` (g_ck) alone does too. Only the pair authenticates.
 *
 * The file is re-read on every request, so an expired session can be replaced
 * without restarting the server. Reading a few hundred local bytes is noise
 * next to the HTTP round trip it precedes; if that ever stops holding, cache
 * it by mtime rather than reading once at startup — reading once would bring
 * back the restart.
 */
export const sessionAuth: AuthStrategy = (cfg) => {
  const { cookie, userToken } = readSessionFile(cfg.sessionFile);
  return { Cookie: cookie, 'X-UserToken': userToken };
};

export function authFor(cfg: Config): AuthStrategy {
  return cfg.authMode === 'session' ? sessionAuth : basicAuth;
}

function readSessionFile(path: string): SessionCredentials {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SnApiError({
      status: 0,
      message: `Cannot read the session file "${path}": ${err instanceof Error ? err.message : String(err)}`,
      detail: SESSION_FILE_FORMAT,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SnApiError({
      status: 0,
      message: `The session file "${path}" is not valid JSON`,
      detail: SESSION_FILE_FORMAT,
    });
  }

  const fields = (parsed ?? {}) as Record<string, unknown>;
  const cookie = trimmedString(fields.cookie);
  const userToken = trimmedString(fields.userToken);

  const missing: string[] = [];
  if (!cookie) missing.push('"cookie"');
  if (!userToken) missing.push('"userToken"');
  if (missing.length > 0) {
    throw new SnApiError({
      status: 0,
      message: `The session file "${path}" has no non-empty ${missing.join(' and ')} value`,
      detail: SESSION_FILE_FORMAT,
    });
  }

  return { cookie, userToken };
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
