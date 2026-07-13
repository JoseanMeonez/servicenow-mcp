/**
 * Live smoke tests against a real ServiceNow instance.
 * Skipped unless SN_BASE_URL / SN_USERNAME / SN_PASSWORD are set
 * (via environment or a .env file in the repo root).
 * Run with: npm run test:live
 *
 * These tests never mutate the instance: writes are only *attempted*
 * when the gate is expected to block them.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SnClient } from '../../src/client/snClient.js';
import { getCurrentUpdateSet, assertWritable } from '../../src/gate.js';

try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the real environment
}

const hasEnv = Boolean(
  process.env.SN_BASE_URL && process.env.SN_USERNAME && process.env.SN_PASSWORD,
);

describe.skipIf(!hasEnv)('live smoke against real instance', () => {
  const cfg = hasEnv ? loadConfig() : null!;
  const client = hasEnv ? new SnClient(cfg) : null!;

  it('authenticates and queries the incident table', async () => {
    const result = await client.queryTable('incident', {
      fields: ['sys_id', 'number'],
      limit: 1,
    });
    expect(Array.isArray(result.records)).toBe(true);
  });

  it('reads the current update set', async () => {
    const updateSet = await getCurrentUpdateSet(client, cfg);
    expect(updateSet.name).toBeTruthy();
  });

  it('reads a table schema including inherited fields', async () => {
    const schema = await client.getTableSchema('incident');
    const names = schema.map((f) => f.name);
    expect(names).toContain('short_description'); // inherited from task
  });

  it('gate blocks writes on Default, allows them on a named set', async () => {
    const writeCfg = { ...cfg, allowWrites: true, requireUpdateSet: true };
    const current = await getCurrentUpdateSet(client, cfg);
    if (current.name === 'Default') {
      await expect(assertWritable(client, writeCfg)).rejects.toThrow(/Default/);
    } else {
      await expect(assertWritable(client, writeCfg)).resolves.toMatchObject({
        name: current.name,
      });
    }
  });
});
