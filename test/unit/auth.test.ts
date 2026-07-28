import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config.js';
import { authFor, basicAuth, sessionAuth } from '../../src/client/auth.js';
import { SnApiError } from '../../src/errors.js';

function cfgWith(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'https://test.service-now.com',
    authMode: 'basic',
    username: 'admin',
    password: 'secret',
    sessionFile: '',
    allowWrites: false,
    requireUpdateSet: true,
    defaultLimit: 50,
    maxLimit: 500,
    requestTimeoutMs: 30000,
    retryMaxAttempts: 3,
    requireDocsPrecheck: false,
    docsRelease: 'australia',
    ...overrides,
  };
}

let dir: string;
let sessionFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sn-mcp-auth-'));
  sessionFile = join(dir, 'session.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSession(content: unknown): void {
  writeFileSync(sessionFile, typeof content === 'string' ? content : JSON.stringify(content));
}

describe('authFor', () => {
  it('selects the strategy from the configured auth mode', () => {
    expect(authFor(cfgWith({ authMode: 'basic' }))).toBe(basicAuth);
    expect(authFor(cfgWith({ authMode: 'session' }))).toBe(sessionAuth);
  });
});

describe('sessionAuth', () => {
  it('sends the cookie and the g_ck CSRF token', () => {
    writeSession({ cookie: 'JSESSIONID=ABC; glide_user_route=glide.1', userToken: 'ck-123' });
    expect(sessionAuth(cfgWith({ authMode: 'session', sessionFile }))).toEqual({
      Cookie: 'JSESSIONID=ABC; glide_user_route=glide.1',
      'X-UserToken': 'ck-123',
    });
  });

  it('picks up a replaced session without a restart', () => {
    const cfg = cfgWith({ authMode: 'session', sessionFile });
    writeSession({ cookie: 'JSESSIONID=OLD', userToken: 'ck-1' });
    expect(sessionAuth(cfg).Cookie).toBe('JSESSIONID=OLD');

    writeSession({ cookie: 'JSESSIONID=NEW', userToken: 'ck-2' });
    expect(sessionAuth(cfg).Cookie).toBe('JSESSIONID=NEW');
  });

  it('trims surrounding whitespace from captured values', () => {
    writeSession({ cookie: '  JSESSIONID=ABC  ', userToken: '  ck-123  ' });
    expect(sessionAuth(cfgWith({ authMode: 'session', sessionFile }))).toEqual({
      Cookie: 'JSESSIONID=ABC',
      'X-UserToken': 'ck-123',
    });
  });

  it('reports a missing file with the expected format', () => {
    const cfg = cfgWith({ authMode: 'session', sessionFile: join(dir, 'nope.json') });
    try {
      sessionAuth(cfg);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SnApiError);
      expect((err as Error).message).toContain('Cannot read the session file');
      expect((err as SnApiError).detail).toContain('userToken');
    }
  });

  it('rejects invalid JSON', () => {
    writeSession('not json');
    expect(() => sessionAuth(cfgWith({ authMode: 'session', sessionFile }))).toThrow(
      /not valid JSON/,
    );
  });

  // Verified against a live instance: the cookie alone answers 401, and so
  // does X-UserToken alone. Only the pair authenticates — on reads too.
  it.each([
    [{ cookie: 'JSESSIONID=ABC' }, /no non-empty "userToken" value/],
    [{ cookie: 'JSESSIONID=ABC', userToken: '  ' }, /no non-empty "userToken" value/],
    [{ userToken: 'ck-123' }, /no non-empty "cookie" value/],
    [{ cookie: '', userToken: 'ck-123' }, /no non-empty "cookie" value/],
    [{ cookie: 42, userToken: 'ck-123' }, /no non-empty "cookie" value/],
    [{}, /no non-empty "cookie" and "userToken" value/],
  ])('rejects an incomplete session file: %j', (content, expected) => {
    writeSession(content);
    expect(() => sessionAuth(cfgWith({ authMode: 'session', sessionFile }))).toThrow(expected);
  });
});
