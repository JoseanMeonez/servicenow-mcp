import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import type { SnClient } from './client/snClient.js';
import {
  registerRecordReadTools,
  registerRecordWriteTools,
  registerAggregateTools,
  registerSchemaTools,
  registerUpdateSetReadTools,
  registerUpdateSetWriteTools,
} from './tools/index.js';

export const SERVER_VERSION = '0.1.0';

export function buildServer(cfg: Config, client: SnClient): McpServer {
  const server = new McpServer({ name: 'servicenow-mcp', version: SERVER_VERSION });

  registerRecordReadTools(server, client, cfg);
  registerAggregateTools(server, client);
  registerSchemaTools(server, client);
  registerUpdateSetReadTools(server, client, cfg);

  if (cfg.allowWrites) {
    registerRecordWriteTools(server, client, cfg);
    registerUpdateSetWriteTools(server, client, cfg);
  }

  return server;
}
