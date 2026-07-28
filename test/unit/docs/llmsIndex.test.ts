import { describe, it, expect, vi } from 'vitest';
import { parseLlmsIndex, searchLlmsIndex, fetchLlmsIndex } from '../../../src/docs/llmsIndex.js';

const FIXTURE = `# ServiceNow Docs

> Official documentation for the ServiceNow platform.

## Table API

- [Table API Overview](table-api/overview.md): Introduction to the Table API
- [Query Encoding](table-api/query-encoding.md): How to build encoded queries
- this line is not a valid entry
- [No description entry](table-api/no-desc.md)

## Update Sets

- [Update Set Basics](update-sets/basics.md): Managing update sets
`;

describe('parseLlmsIndex', () => {
  it('parses sections and entries from a fixture', () => {
    const index = parseLlmsIndex(FIXTURE);
    expect(index.entries).toHaveLength(4);
    expect(index.entries[0]).toEqual({
      title: 'Table API Overview',
      path: 'table-api/overview.md',
      section: 'Table API',
      description: 'Introduction to the Table API',
    });
  });

  it('is tolerant of malformed lines', () => {
    const index = parseLlmsIndex(FIXTURE);
    expect(index.entries.some((e) => e.title === 'No description entry')).toBe(true);
    expect(index.entries.every((e) => e.title !== 'this line is not a valid entry')).toBe(true);
  });

  it('handles an entry without a description', () => {
    const index = parseLlmsIndex(FIXTURE);
    const entry = index.entries.find((e) => e.path === 'table-api/no-desc.md');
    expect(entry?.description).toBeUndefined();
  });
});

describe('searchLlmsIndex', () => {
  const index = parseLlmsIndex(FIXTURE);

  it('ranks results by keyword match count', () => {
    const results = searchLlmsIndex(index, 'query encoding');
    expect(results[0].path).toBe('table-api/query-encoding.md');
  });

  it('returns empty results for no matches', () => {
    expect(searchLlmsIndex(index, 'nonexistent-topic-xyz')).toEqual([]);
  });

  it('returns empty results for an empty query', () => {
    expect(searchLlmsIndex(index, '   ')).toEqual([]);
  });

  it('limits results to topN', () => {
    const results = searchLlmsIndex(index, 'update', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe('fetchLlmsIndex', () => {
  it('fetches using the injected fake fetch, not real network', async () => {
    const fakeFetch = vi.fn(async () => new Response(FIXTURE, { status: 200 }));
    const text = await fetchLlmsIndex('australia', fakeFetch as unknown as typeof fetch);
    expect(text).toBe(FIXTURE);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/australia/llms.txt',
    );
  });

  it('throws when the fetch returns a non-2xx response', async () => {
    const fakeFetch = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(fetchLlmsIndex('australia', fakeFetch as unknown as typeof fetch)).rejects.toThrow(
      /404/,
    );
  });
});
