import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SnClient } from '../client/snClient.js';
import { toToolErrorResult } from '../errors.js';

export function registerSchemaTools(server: McpServer, client: SnClient): void {
  server.registerTool(
    'servicenow_get_table_schema',
    {
      title: 'Get table schema',
      description:
        'List fields of a table from sys_dictionary, including inherited fields from parent tables.',
      inputSchema: {
        table: z.string().min(1),
        mandatoryOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        let fields = await client.getTableSchema(args.table);
        if (args.mandatoryOnly) fields = fields.filter((f) => f.mandatory);
        const summary = `${fields.length} field(s) on ${args.table}`;
        return {
          content: [{ type: 'text', text: `${summary}\n${JSON.stringify(fields, null, 2)}` }],
          structuredContent: { fields },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );
}
