import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../../src/config.js';

const baseEnv = {
  SN_BASE_URL: 'https://dev12345.service-now.com',
  SN_USERNAME: 'admin',
  SN_PASSWORD: 'secret',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg).toMatchObject({
      baseUrl: 'https://dev12345.service-now.com',
      username: 'admin',
      password: 'secret',
      allowWrites: false,
      requireUpdateSet: true,
      defaultLimit: 50,
      maxLimit: 500,
      requestTimeoutMs: 30000,
      retryMaxAttempts: 3,
      requireDocsPrecheck: false,
      docsRelease: 'australia',
    });
  });

  it('aggregates every missing variable into one error', () => {
    try {
      loadConfig({});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain('SN_BASE_URL');
      expect(message).toContain('SN_USERNAME');
      expect(message).toContain('SN_PASSWORD');
    }
  });

  it('strips trailing slashes from the base URL', () => {
    const cfg = loadConfig({ ...baseEnv, SN_BASE_URL: 'https://x.service-now.com///' });
    expect(cfg.baseUrl).toBe('https://x.service-now.com');
  });

  it('rejects non-https URLs', () => {
    expect(() => loadConfig({ ...baseEnv, SN_BASE_URL: 'http://x.service-now.com' })).toThrow(
      /https/,
    );
  });

  it('rejects invalid booleans and integers', () => {
    expect(() => loadConfig({ ...baseEnv, SN_MCP_ALLOW_WRITES: 'yes' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...baseEnv, SN_MCP_DEFAULT_LIMIT: '-5' })).toThrow(ConfigError);
  });

  it('applies docs-precheck defaults when unset', () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.requireDocsPrecheck).toBe(false);
    expect(cfg.docsRelease).toBe('australia');
  });

  it('parses docs-precheck overrides', () => {
    const cfg = loadConfig({
      ...baseEnv,
      SN_MCP_REQUIRE_DOCS_PRECHECK: 'true',
      SN_MCP_DOCS_RELEASE: 'washingtondc',
    });
    expect(cfg.requireDocsPrecheck).toBe(true);
    expect(cfg.docsRelease).toBe('washingtondc');
  });

  it('rejects an invalid SN_MCP_REQUIRE_DOCS_PRECHECK value', () => {
    expect(() =>
      loadConfig({ ...baseEnv, SN_MCP_REQUIRE_DOCS_PRECHECK: 'maybe' }),
    ).toThrow(ConfigError);
  });

  it('parses overrides', () => {
    const cfg = loadConfig({
      ...baseEnv,
      SN_MCP_ALLOW_WRITES: 'true',
      SN_MCP_REQUIRE_UPDATE_SET: 'false',
      SN_MCP_DEFAULT_LIMIT: '10',
      SN_MCP_MAX_LIMIT: '100',
    });
    expect(cfg.allowWrites).toBe(true);
    expect(cfg.requireUpdateSet).toBe(false);
    expect(cfg.defaultLimit).toBe(10);
    expect(cfg.maxLimit).toBe(100);
  });
});
