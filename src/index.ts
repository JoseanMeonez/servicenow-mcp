#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { SnClient } from './client/snClient.js';
import { buildServer } from './server.js';

try {
  // Optional .env in cwd for local development. For per-instance profiles use
  // Node's native flag instead: node --env-file=instances/dev.env dist/index.js
  try {
    process.loadEnvFile();
  } catch {
    // no .env present — fine
  }

  const cfg = loadConfig();
  const client = new SnClient(cfg);
  const server = buildServer(cfg, client);
  await server.connect(new StdioServerTransport());
} catch (err) {
  process.stderr.write(
    `[servicenow-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
