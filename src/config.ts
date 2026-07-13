export interface Config {
  baseUrl: string;
  username: string;
  password: string;
  allowWrites: boolean;
  requireUpdateSet: boolean;
  defaultLimit: number;
  maxLimit: number;
  requestTimeoutMs: number;
  retryMaxAttempts: number;
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

  const username = env.SN_USERNAME ?? '';
  if (!username) problems.push('SN_USERNAME is required');
  const password = env.SN_PASSWORD ?? '';
  if (!password) problems.push('SN_PASSWORD is required');

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

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    baseUrl,
    username,
    password,
    allowWrites,
    requireUpdateSet,
    defaultLimit,
    maxLimit,
    requestTimeoutMs,
    retryMaxAttempts,
  };
}
