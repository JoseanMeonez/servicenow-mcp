import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SnClient } from '../client/snClient.js';
import { toToolErrorResult } from '../errors.js';

export function registerAggregateTools(server: McpServer, client: SnClient): void {
  server.registerTool(
    'servicenow_get_aggregate',
    {
      title: 'Aggregate (stats)',
      description:
        'Run the Aggregate/Stats API on a table: count, avg/sum/min/max, optionally grouped.',
      inputSchema: {
        table: z.string().min(1),
        query: z.string().optional().describe('Encoded query filter'),
        groupBy: z.array(z.string()).optional(),
        count: z.boolean().optional(),
        avgFields: z.array(z.string()).optional(),
        sumFields: z.array(z.string()).optional(),
        minFields: z.array(z.string()).optional(),
        maxFields: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const results = await client.aggregate(args.table, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          structuredContent: { results },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );
}
