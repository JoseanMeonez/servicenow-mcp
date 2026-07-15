import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Config } from '../../src/config.js';
import type { SnClient } from '../../src/client/snClient.js';
import { buildServer } from '../../src/server.js';

const baseCfg: Config = {
  baseUrl: 'https://test.service-now.com',
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
};

const READ_TOOLS = [
  'servicenow_query_records',
  'servicenow_get_record',
  'servicenow_get_aggregate',
  'servicenow_get_table_schema',
  'servicenow_get_current_update_set',
  'servicenow_docs_search',
  'servicenow_docs_get',
  'servicenow_best_practices',
  'servicenow_docs_precheck',
];
const WRITE_TOOLS = [
  'servicenow_create_record',
  'servicenow_update_record',
  'servicenow_delete_record',
  'servicenow_set_current_update_set',
];

interface SnClientMockState {
  currentUpdateSet: 'default' | 'named';
}

function mockSnClient(state: SnClientMockState): SnClient {
  const queryTable = vi.fn(async (table: string) => {
    if (table === 'sys_user') return { records: [{ sys_id: 'user1' }], hasMore: false };
    if (table === 'sys_user_preference') {
      return state.currentUpdateSet === 'named'
        ? { records: [{ sys_id: 'pref1', value: 'us1' }], hasMore: false }
        : { records: [], hasMore: false };
    }
    return {
      records: [{ sys_id: 'a'.repeat(32), short_description: 'Test incident' }],
      totalCount: 1,
      hasMore: false,
    };
  });
  const getRecord = vi.fn(async (table: string) => {
    if (table === 'sys_update_set')
      return { sys_id: 'us1', name: 'Feature X', state: 'in progress' };
    return { sys_id: 'a'.repeat(32), short_description: 'Test incident' };
  });
  const createRecord = vi.fn(async () => ({ sys_id: 'new1'.padEnd(32, '0') }));
  const updateRecord = vi.fn(async () => ({ sys_id: 'a'.repeat(32) }));
  const deleteRecord = vi.fn(async () => undefined);
  const aggregate = vi.fn(async () => [{ stats: { count: '42' } }]);
  const getTableSchema = vi.fn(async () => [
    {
      name: 'short_description',
      label: 'Short description',
      mandatory: true,
      type: 'string',
      table: 'incident',
    },
  ]);
  return {
    queryTable,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
    aggregate,
    getTableSchema,
  } as unknown as SnClient;
}

async function connect(cfg: Config, snClient: SnClient) {
  const server = buildServer(cfg, snClient);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('server over InMemoryTransport', () => {
  it('exposes only read tools when writes are disabled', async () => {
    const client = await connect(baseCfg, mockSnClient({ currentUpdateSet: 'named' }));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS].sort());
  });

  it('exposes all read and write tools when writes are enabled', async () => {
    const client = await connect(
      { ...baseCfg, allowWrites: true },
      mockSnClient({ currentUpdateSet: 'named' }),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it('round-trips servicenow_query_records with structuredContent', async () => {
    const client = await connect(baseCfg, mockSnClient({ currentUpdateSet: 'named' }));
    const result = await client.callTool({
      name: 'servicenow_query_records',
      arguments: { table: 'incident', query: 'active=true', limit: 5 },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { records: { sys_id: string }[] };
    expect(structured.records).toHaveLength(1);
    expect(structured.records[0].short_description).toBe('Test incident');
  });

  it('rejects delete without confirm=true before reaching the handler', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'named' });
    const client = await connect({ ...baseCfg, allowWrites: true }, snClient);
    const result = await client.callTool({
      name: 'servicenow_delete_record',
      arguments: { table: 'incident', sysId: 'a'.repeat(32), confirm: false },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/Invalid arguments|invalid_literal/);
    expect(snClient.deleteRecord as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('blocks create while the current update set is Default', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'default' });
    const client = await connect({ ...baseCfg, allowWrites: true }, snClient);
    const result = await client.callTool({
      name: 'servicenow_create_record',
      arguments: { table: 'incident', fields: { short_description: 'x' } },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/Default/);
    expect(snClient.createRecord as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('allows create under a named update set and echoes it back', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'named' });
    const client = await connect({ ...baseCfg, allowWrites: true }, snClient);
    const result = await client.callTool({
      name: 'servicenow_create_record',
      arguments: { table: 'incident', fields: { short_description: 'x' } },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { updateSet: { name: string } };
    expect(structured.updateSet.name).toBe('Feature X');
  });

  it('switches the current update set', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'default' });
    const client = await connect({ ...baseCfg, allowWrites: true }, snClient);
    const result = await client.callTool({
      name: 'servicenow_set_current_update_set',
      arguments: { sysId: 'b'.repeat(32) },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { updateSet: { name: string } };
    expect(structured.updateSet.name).toBe('Feature X');
  });

  it('surfaces gate errors on update while writes are enabled but set is Default', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'default' });
    const client = await connect({ ...baseCfg, allowWrites: true }, snClient);
    const result = await client.callTool({
      name: 'servicenow_update_record',
      arguments: { table: 'incident', sysId: 'a'.repeat(32), fields: { state: '2' } },
    });
    expect(result.isError).toBe(true);
    expect(snClient.updateRecord as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('advisory mode: write succeeds with no precheckToken supplied (zero behavior change)', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'named' });
    const client = await connect({ ...baseCfg, allowWrites: true }, snClient);
    const result = await client.callTool({
      name: 'servicenow_create_record',
      arguments: { table: 'sys_dictionary', fields: { short_description: 'x' } },
    });
    expect(result.isError).toBeFalsy();
    expect(snClient.createRecord as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('strict mode: rejects a sys_* create without a precheckToken, succeeds with a valid one', async () => {
    const snClient = mockSnClient({ currentUpdateSet: 'named' });
    const strictCfg = { ...baseCfg, allowWrites: true, requireDocsPrecheck: true };
    const client = await connect(strictCfg, snClient);

    const rejected = await client.callTool({
      name: 'servicenow_create_record',
      arguments: { table: 'sys_dictionary', fields: { short_description: 'x' } },
    });
    expect(rejected.isError).toBe(true);
    expect(snClient.createRecord as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();

    const precheck = await client.callTool({
      name: 'servicenow_docs_precheck',
      arguments: { table: 'sys_dictionary', operation: 'create' },
    });
    expect(precheck.isError).toBeFalsy();
    const precheckStructured = precheck.structuredContent as { precheckToken?: string };
    expect(precheckStructured.precheckToken).toBeDefined();

    const allowed = await client.callTool({
      name: 'servicenow_create_record',
      arguments: {
        table: 'sys_dictionary',
        fields: { short_description: 'x' },
        precheckToken: precheckStructured.precheckToken,
      },
    });
    expect(allowed.isError).toBeFalsy();
    expect(snClient.createRecord as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });
});
