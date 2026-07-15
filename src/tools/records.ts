import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { SnClient } from '../client/snClient.js';
import { toToolErrorResult } from '../errors.js';
import { assertWritable, assertPrecheckToken } from '../gate.js';

const table = z.string().min(1).describe('Table name, e.g. "incident"');
const sysId = z.string().length(32).describe('sys_id of the record (32 chars)');

export function registerRecordReadTools(server: McpServer, client: SnClient, cfg: Config): void {
  server.registerTool(
    'servicenow_query_records',
    {
      title: 'Query records',
      description:
        'Query a ServiceNow table with an encoded query. Returns records plus pagination info ' +
        `(limit is capped at ${cfg.maxLimit}).`,
      inputSchema: {
        table,
        query: z.string().optional().describe('Encoded query, e.g. "active=true^priority=1"'),
        fields: z.array(z.string()).optional().describe('Fields to return (recommended)'),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
        displayValue: z.enum(['true', 'false', 'all']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const result = await client.queryTable(args.table, args);
        const summary = `${result.records.length} record(s)${
          result.totalCount !== undefined ? ` of ${result.totalCount}` : ''
        } (offset ${args.offset ?? 0}, hasMore: ${result.hasMore})`;
        return {
          content: [
            { type: 'text', text: `${summary}\n${JSON.stringify(result.records, null, 2)}` },
          ],
          structuredContent: {
            records: result.records,
            totalCount: result.totalCount,
            hasMore: result.hasMore,
            nextOffset: result.nextOffset,
          },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );

  server.registerTool(
    'servicenow_get_record',
    {
      title: 'Get record',
      description: 'Fetch a single record by table and sys_id.',
      inputSchema: { table, sysId, fields: z.array(z.string()).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const record = await client.getRecord(args.table, args.sysId, args.fields);
        return {
          content: [{ type: 'text', text: JSON.stringify(record, null, 2) }],
          structuredContent: { record },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );
}

export function registerRecordWriteTools(server: McpServer, client: SnClient, cfg: Config): void {
  server.registerTool(
    'servicenow_create_record',
    {
      title: 'Create record',
      description:
        'Create a record. Refused while the current update set is "Default" (update-set gate).',
      inputSchema: {
        table,
        fields: z.record(z.string(), z.unknown()),
        precheckToken: z
          .string()
          .optional()
          .describe('Optional token from servicenow_docs_precheck; required in strict mode'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        const updateSet = await assertWritable(client, cfg);
        assertPrecheckToken(cfg, {
          table: args.table,
          operation: 'create',
          precheckToken: args.precheckToken,
        });
        const record = await client.createRecord(args.table, args.fields);
        return {
          content: [
            {
              type: 'text',
              text: `Created ${args.table} record${updateSet ? ` under update set "${updateSet.name}"` : ''}:\n${JSON.stringify(record, null, 2)}`,
            },
          ],
          structuredContent: { record, updateSet },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );

  server.registerTool(
    'servicenow_update_record',
    {
      title: 'Update record',
      description:
        'Update fields on a record. Refused while the current update set is "Default" (update-set gate).',
      inputSchema: {
        table,
        sysId,
        fields: z.record(z.string(), z.unknown()),
        precheckToken: z
          .string()
          .optional()
          .describe('Optional token from servicenow_docs_precheck; required in strict mode'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        const updateSet = await assertWritable(client, cfg);
        assertPrecheckToken(cfg, {
          table: args.table,
          operation: 'update',
          precheckToken: args.precheckToken,
        });
        const record = await client.updateRecord(args.table, args.sysId, args.fields);
        return {
          content: [
            {
              type: 'text',
              text: `Updated ${args.table}/${args.sysId}${updateSet ? ` under update set "${updateSet.name}"` : ''}:\n${JSON.stringify(record, null, 2)}`,
            },
          ],
          structuredContent: { record, updateSet },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );

  server.registerTool(
    'servicenow_delete_record',
    {
      title: 'Delete record',
      description:
        'Delete a record. Requires confirm=true and is refused while the current update set is "Default".',
      inputSchema: {
        table,
        sysId,
        confirm: z.literal(true).describe('Must be exactly true'),
        precheckToken: z
          .string()
          .optional()
          .describe('Optional token from servicenow_docs_precheck; required in strict mode'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      try {
        const updateSet = await assertWritable(client, cfg);
        assertPrecheckToken(cfg, {
          table: args.table,
          operation: 'delete',
          precheckToken: args.precheckToken,
        });
        await client.deleteRecord(args.table, args.sysId);
        return {
          content: [{ type: 'text', text: `Deleted ${args.table}/${args.sysId}` }],
          structuredContent: { deleted: true, table: args.table, sysId: args.sysId, updateSet },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );
}
