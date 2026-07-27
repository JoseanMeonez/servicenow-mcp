import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { SnClient } from '../client/snClient.js';
import { toToolErrorResult, SnApiError } from '../errors.js';
import { getCurrentUpdateSet, setCurrentUpdateSet, assertPrecheckToken } from '../gate.js';

export function registerUpdateSetReadTools(server: McpServer, client: SnClient, cfg: Config): void {
  server.registerTool(
    'servicenow_get_current_update_set',
    {
      title: 'Get current update set',
      description: "Show the authenticated user's current update set on the instance.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const updateSet = await getCurrentUpdateSet(client, cfg);
        return {
          content: [
            {
              type: 'text',
              text: `Current update set: "${updateSet.name}"${updateSet.state ? ` (state: ${updateSet.state})` : ''}${updateSet.sysId ? ` [${updateSet.sysId}]` : ''}`,
            },
          ],
          structuredContent: { updateSet },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );
}

export function registerUpdateSetWriteTools(
  server: McpServer,
  client: SnClient,
  cfg: Config,
): void {
  server.registerTool(
    'servicenow_set_current_update_set',
    {
      title: 'Set current update set',
      description:
        "Switch the authenticated user's current update set. This is how you move off " +
        '"Default" so the write gate allows changes.',
      inputSchema: {
        sysId: z.string().length(32).describe('sys_id of the target update set'),
        precheckToken: z
          .string()
          .optional()
          .describe('Optional token from servicenow_docs_precheck; required in strict mode'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        // Only the allow-writes flag applies here; the Default check would
        // make it impossible to ever switch away from Default.
        if (!cfg.allowWrites) {
          throw new SnApiError({
            status: 409,
            message:
              'Writes are disabled. Set SN_MCP_ALLOW_WRITES=true and restart the MCP server.',
          });
        }
        assertPrecheckToken(cfg, {
          table: 'sys_user_preference',
          operation: 'update',
          precheckToken: args.precheckToken,
        });
        const updateSet = await setCurrentUpdateSet(client, cfg, args.sysId);
        return {
          content: [
            {
              type: 'text',
              text: `Current update set is now "${updateSet.name}"${updateSet.state ? ` (state: ${updateSet.state})` : ''}`,
            },
          ],
          structuredContent: { updateSet },
        };
      } catch (err) {
        return toToolErrorResult(err);
      }
    },
  );
}
