/**
 * `basic` sends username/password. `session` reuses a ServiceNow web session
 * established through SSO — for instances where Basic Auth is blocked and no
 * OAuth Application Registry entry can be created.
 */
export type AuthMode = 'basic' | 'session';

export interface Config {
  baseUrl: string;
  authMode: AuthMode;
  username: string;
  password: string;
  sessionFile: string;
  allowWrites: boolean;
  requireUpdateSet: boolean;
  defaultLimit: number;
  maxLimit: number;
  requestTimeoutMs: number;
  retryMaxAttempts: number;
  requireDocsPrecheck: boolean;
  docsRelease: string;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

function parseBool(
  raw: string | undefined,
  fallback: boolean,
  name: string,
  problems: string[],
): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  problems.push(`${name} must be "true" or "false", got "${raw}"`);
  return fallback;
}

function parseAuthMode(raw: string | undefined, problems: string[]): AuthMode {
  if (raw === undefined || raw === '') return 'basic';
  if (raw === 'basic' || raw === 'session') return raw;
  problems.push(`SN_AUTH_MODE must be "basic" or "session", got "${raw}"`);
  return 'basic';
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  problems: string[],
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    problems.push(`${name} must be a positive integer, got "${raw}"`);
    return fallback;
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  let baseUrl = '';
  const rawUrl = env.SN_BASE_URL ?? '';
  if (!rawUrl) {
    problems.push('SN_BASE_URL is required (e.g. https://dev12345.service-now.com)');
  } else {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:') {
        problems.push(`SN_BASE_URL must use https, got "${rawUrl}"`);
      }
      baseUrl = rawUrl.replace(/\/+$/, '');
    } catch {
      problems.push(`SN_BASE_URL is not a valid URL: "${rawUrl}"`);
    }
  }

  const authMode = parseAuthMode(env.SN_AUTH_MODE, problems);

  // Required in both modes: it is how the write gate resolves whose current
  // update set to read, not only a Basic Auth credential.
  const username = env.SN_USERNAME ?? '';
  if (!username) problems.push('SN_USERNAME is required');

  const password = env.SN_PASSWORD ?? '';
  if (authMode === 'basic' && !password) {
    problems.push('SN_PASSWORD is required when SN_AUTH_MODE=basic');
  }

  const sessionFile = env.SN_SESSION_FILE ?? '';
  if (authMode === 'session' && !sessionFile) {
    problems.push('SN_SESSION_FILE is required when SN_AUTH_MODE=session');
  }

  const allowWrites = parseBool(env.SN_MCP_ALLOW_WRITES, false, 'SN_MCP_ALLOW_WRITES', problems);
  const requireUpdateSet = parseBool(
    env.SN_MCP_REQUIRE_UPDATE_SET,
    true,
    'SN_MCP_REQUIRE_UPDATE_SET',
    problems,
  );
  const defaultLimit = parsePositiveInt(
    env.SN_MCP_DEFAULT_LIMIT,
    50,
    'SN_MCP_DEFAULT_LIMIT',
    problems,
  );
  const maxLimit = parsePositiveInt(env.SN_MCP_MAX_LIMIT, 500, 'SN_MCP_MAX_LIMIT', problems);
  const requestTimeoutMs = parsePositiveInt(
    env.SN_MCP_REQUEST_TIMEOUT_MS,
    30000,
    'SN_MCP_REQUEST_TIMEOUT_MS',
    problems,
  );
  const retryMaxAttempts = parsePositiveInt(
    env.SN_MCP_RETRY_MAX_ATTEMPTS,
    3,
    'SN_MCP_RETRY_MAX_ATTEMPTS',
    problems,
  );
  const requireDocsPrecheck = parseBool(
    env.SN_MCP_REQUIRE_DOCS_PRECHECK,
    false,
    'SN_MCP_REQUIRE_DOCS_PRECHECK',
    problems,
  );
  const rawDocsRelease = env.SN_MCP_DOCS_RELEASE ?? '';
  const docsRelease = rawDocsRelease === '' ? 'australia' : rawDocsRelease;
  if (docsRelease.trim() === '') {
    problems.push('SN_MCP_DOCS_RELEASE must not be empty when set');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    baseUrl,
    authMode,
    username,
    password,
    sessionFile,
    allowWrites,
    requireUpdateSet,
    defaultLimit,
    maxLimit,
    requestTimeoutMs,
    retryMaxAttempts,
    requireDocsPrecheck,
    docsRelease,
  };
}
