import { describe, it, expect, vi } from 'vitest';
import type { Config } from '../../src/config.js';
import type { SnClient } from '../../src/client/snClient.js';
import {
  getCurrentUpdateSet,
  assertWritable,
  setCurrentUpdateSet,
  assertPrecheckToken,
} from '../../src/gate.js';
import { sign } from '../../src/docs/token.js';

const cfg: Config = {
  baseUrl: 'https://test.service-now.com',
  username: 'admin',
  password: 'secret',
  allowWrites: true,
  requireUpdateSet: true,
  defaultLimit: 50,
  maxLimit: 500,
  requestTimeoutMs: 30000,
  retryMaxAttempts: 3,
  requireDocsPrecheck: false,
  docsRelease: 'australia',
};

interface MockState {
  userRecords?: { sys_id: string }[];
  prefRecords?: { sys_id?: string; value?: string }[];
  updateSet?: { sys_id: string; name: string; state: string };
}

function mockClient(state: MockState) {
  const queryTable = vi.fn(async (table: string) => {
    if (table === 'sys_user')
      return { records: state.userRecords ?? [{ sys_id: 'user1' }], hasMore: false };
    if (table === 'sys_user_preference')
      return { records: state.prefRecords ?? [], hasMore: false };
    throw new Error(`unexpected table ${table}`);
  });
  const getRecord = vi.fn(async () => state.updateSet);
  const updateRecord = vi.fn(async () => ({}));
  const createRecord = vi.fn(async () => ({}));
  return {
    client: { queryTable, getRecord, updateRecord, createRecord } as unknown as SnClient,
    queryTable,
    getRecord,
    updateRecord,
    createRecord,
  };
}

describe('getCurrentUpdateSet', () => {
  it('returns Default when no preference row exists (safe fallback)', async () => {
    const { client } = mockClient({ prefRecords: [] });
    await expect(getCurrentUpdateSet(client, cfg)).resolves.toEqual({ sysId: '', name: 'Default' });
  });

  it('resolves the named update set from the preference', async () => {
    const { client } = mockClient({
      prefRecords: [{ value: 'us1' }],
      updateSet: { sys_id: 'us1', name: 'Feature X', state: 'in progress' },
    });
    await expect(getCurrentUpdateSet(client, cfg)).resolves.toEqual({
      sysId: 'us1',
      name: 'Feature X',
      state: 'in progress',
    });
  });

  it('fails clearly when the user does not exist', async () => {
    const { client } = mockClient({ userRecords: [] });
    await expect(getCurrentUpdateSet(client, cfg)).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertWritable', () => {
  it('throws when writes are disabled, without touching the instance', async () => {
    const { client, queryTable } = mockClient({});
    await expect(assertWritable(client, { ...cfg, allowWrites: false })).rejects.toThrow(
      /SN_MCP_ALLOW_WRITES/,
    );
    expect(queryTable).not.toHaveBeenCalled();
  });

  it('skips the update-set check when requireUpdateSet is false', async () => {
    const { client, queryTable } = mockClient({});
    await expect(
      assertWritable(client, { ...cfg, requireUpdateSet: false }),
    ).resolves.toBeUndefined();
    expect(queryTable).not.toHaveBeenCalled();
  });

  it('refuses writes while the current set is Default', async () => {
    const { client } = mockClient({ prefRecords: [] });
    await expect(assertWritable(client, cfg)).rejects.toThrow(/Default/);
  });

  it('returns the update set info when a named set is active', async () => {
    const { client } = mockClient({
      prefRecords: [{ value: 'us1' }],
      updateSet: { sys_id: 'us1', name: 'Feature X', state: 'in progress' },
    });
    await expect(assertWritable(client, cfg)).resolves.toMatchObject({ name: 'Feature X' });
  });
});

describe('setCurrentUpdateSet', () => {
  const updateSet = { sys_id: 'us2', name: 'Feature Y', state: 'in progress' };

  it('updates the existing preference row', async () => {
    const { client, updateRecord, createRecord } = mockClient({
      prefRecords: [{ sys_id: 'pref1' }],
      updateSet,
    });
    const result = await setCurrentUpdateSet(client, cfg, 'us2');
    expect(updateRecord).toHaveBeenCalledWith('sys_user_preference', 'pref1', { value: 'us2' });
    expect(createRecord).not.toHaveBeenCalled();
    expect(result.name).toBe('Feature Y');
  });

  it('creates the preference row when missing', async () => {
    const { client, createRecord } = mockClient({ prefRecords: [], updateSet });
    await setCurrentUpdateSet(client, cfg, 'us2');
    expect(createRecord).toHaveBeenCalledWith('sys_user_preference', {
      user: 'user1',
      name: 'sys_update_set',
      value: 'us2',
    });
  });
});

describe('assertPrecheckToken', () => {
  it('is a no-op in advisory mode (requireDocsPrecheck: false)', () => {
    expect(() =>
      assertPrecheckToken(
        { ...cfg, requireDocsPrecheck: false },
        { table: 'sys_dictionary', operation: 'create' },
      ),
    ).not.toThrow();
  });

  const strictCfg: Config = { ...cfg, requireDocsPrecheck: true };

  it('does not require a token for low-risk create operations in strict mode', () => {
    expect(() =>
      assertPrecheckToken(strictCfg, { table: 'u_my_table', operation: 'create' }),
    ).not.toThrow();
  });

  it('throws when the token is missing for a medium/high-risk operation', () => {
    expect(() =>
      assertPrecheckToken(strictCfg, { table: 'sys_dictionary', operation: 'create' }),
    ).toThrow(/precheck token is required/i);
  });

  it('throws when the operation is delete without a token, even on a low-risk table', () => {
    expect(() =>
      assertPrecheckToken(strictCfg, { table: 'u_my_table', operation: 'delete' }),
    ).toThrow(/precheck token is required/i);
  });

  it('throws when the token is expired', () => {
    vi.useFakeTimers();
    try {
      const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(() =>
        assertPrecheckToken(strictCfg, {
          table: 'incident',
          operation: 'update',
          precheckToken: token,
        }),
      ).toThrow(/expired/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the token signature is tampered', () => {
    const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
    const [payloadEncoded] = token.split('.');
    const tamperedToken = `${payloadEncoded}.deadbeef`;
    expect(() =>
      assertPrecheckToken(strictCfg, {
        table: 'incident',
        operation: 'update',
        precheckToken: tamperedToken,
      }),
    ).toThrow(/invalid/i);
  });

  it('throws when the token table/operation does not match the request', () => {
    const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
    expect(() =>
      assertPrecheckToken(strictCfg, {
        table: 'problem',
        operation: 'update',
        precheckToken: token,
      }),
    ).toThrow(/not "problem"/);
  });

  it('passes through with a valid, matching, unexpired token', () => {
    const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
    expect(() =>
      assertPrecheckToken(strictCfg, { table: 'incident', operation: 'update', precheckToken: token }),
    ).not.toThrow();
  });
});
