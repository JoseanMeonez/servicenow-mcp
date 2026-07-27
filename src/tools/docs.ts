import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { SnClient } from '../client/snClient.js';
import { fetchLlmsIndex, parseLlmsIndex, searchLlmsIndex } from '../docs/llmsIndex.js';
import { fetchDocByPath, DocsFetchError } from '../docs/fetchDoc.js';
import { BEST_PRACTICES } from '../docs/bestPractices/index.js';
import type { BestPracticeArea } from '../docs/bestPractices/types.js';
import { analyzePrecheck } from '../docs/precheck.js';

const BEST_PRACTICE_AREAS: [BestPracticeArea, ...BestPracticeArea[]] = [
  'update-sets',
  'record-ops',
  'contracts',
  'coding-standards',
];

function docsUnavailableResult(reason: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Could not reach ServiceNow docs (${reason}). Try servicenow_best_practices for curated offline guidance instead.`,
      },
    ],
    structuredContent: { error: { status: 0, message: reason } },
    isError: true as const,
  };
}

/**
 * Registers the four read-only docs-guided tools. `client` is accepted for
 * signature symmetry with `register*Tools(server, client, cfg)` but is
 * intentionally unused: these tools never call the ServiceNow instance.
 */
export function registerDocsTools(server: McpServer, _client: SnClient, cfg: Config): void {
  server.registerTool(
    'servicenow_docs_search',
    {
      title: 'Search ServiceNow docs',
      description:
        'Search the llms.txt topic index of the official ServiceNow/ServiceNowDocs ' +
        `repository (release branch: ${cfg.docsRelease}). Returns matching topics with ` +
        'title, path, and section. See https://github.com/ServiceNow/ServiceNowDocs/branches ' +
        'for available release branches.',
      inputSchema: {
        query: z.string().min(1).describe('Search query, e.g. "update set"'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const text = await fetchLlmsIndex(cfg.docsRelease);
        const index = parseLlmsIndex(text);
        const results = searchLlmsIndex(index, args.query, args.limit ?? 10);
        return {
          content: [
            {
              type: 'text',
              text: `${results.length} result(s) for "${args.query}"\n${JSON.stringify(results, null, 2)}`,
            },
          ],
          structuredContent: { results },
        };
      } catch (err) {
        return docsUnavailableResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'servicenow_docs_get',
    {
      title: 'Get a ServiceNow doc',
      description:
        'Fetch the full markdown of a specific doc path from ServiceNow/ServiceNowDocs ' +
        `(release branch: ${cfg.docsRelease}). Use a path from servicenow_docs_search.`,
      inputSchema: {
        path: z.string().min(1).describe('Doc path, e.g. "table-api/overview.md"'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const doc = await fetchDocByPath(cfg.docsRelease, args.path);
        return {
          content: [{ type: 'text', text: doc.markdown }],
          structuredContent: { markdown: doc.markdown, sourceUrl: doc.sourceUrl },
        };
      } catch (err) {
        if (err instanceof DocsFetchError) {
          return {
            content: [
              {
                type: 'text',
                text:
                  err.status === 404
                    ? `Doc not found: ${err.message}`
                    : `Could not reach ServiceNow docs: ${err.message}. Try servicenow_best_practices for curated offline guidance instead.`,
              },
            ],
            structuredContent: { error: { status: err.status, message: err.message } },
            isError: true,
          };
        }
        return docsUnavailableResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'servicenow_best_practices',
    {
      title: 'ServiceNow best practices',
      description:
        'Curated, in-repo guidance for update-set discipline, record operations, ' +
        'contracts/breaking changes, and ServiceNow coding standards. Does not use the network.',
      inputSchema: {
        area: z.enum(BEST_PRACTICE_AREAS).optional().describe('Filter to a single area'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const entries = args.area
        ? BEST_PRACTICES.filter((entry) => entry.area === args.area)
        : BEST_PRACTICES;
      return {
        content: [
          { type: 'text', text: `${entries.length} best-practice entr(y/ies)\n${JSON.stringify(entries, null, 2)}` },
        ],
        structuredContent: { entries },
      };
    },
  );

  server.registerTool(
    'servicenow_docs_precheck',
    {
      title: 'Precheck a ServiceNow write',
      description:
        'Analyze the risk of an intended write operation (table + operation type) and ' +
        'return curated best practices plus, for medium/high-risk operations, a signed ' +
        'precheck token (~10 minute validity) that write tools can accept as `precheckToken`. ' +
        `Strict mode is opt-in via SN_MCP_REQUIRE_DOCS_PRECHECK (currently ${cfg.requireDocsPrecheck ? 'enabled' : 'disabled'}).`,
      inputSchema: {
        table: z.string().min(1).describe('Target table name, e.g. "incident"'),
        operation: z.enum(['create', 'update', 'delete']),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const report = analyzePrecheck(args.table, args.operation);
      return {
        content: [
          {
            type: 'text',
            text:
              `Risk level: ${report.riskLevel}. ${report.matches.length} matching best practice(s).` +
              (report.precheckToken ? ' A precheck token was issued (valid ~10 minutes).' : ''),
          },
        ],
        structuredContent: { ...report },
      };
    },
  );
}
