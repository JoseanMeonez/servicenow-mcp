import { describe, it, expect, vi } from 'vitest';
import { fetchDocByPath, DocsFetchError } from '../../../src/docs/fetchDoc.js';

describe('fetchDocByPath', () => {
  it('returns markdown with attribution on success', async () => {
    const fakeFetch = vi.fn(async () => new Response('# My Doc\n\ncontent', { status: 200 }));
    const result = await fetchDocByPath(
      'australia',
      'table-api/overview.md',
      fakeFetch as unknown as typeof fetch,
    );
    expect(result.markdown).toContain('# My Doc');
    expect(result.markdown).toContain('ServiceNow/ServiceNowDocs');
    expect(result.markdown).toContain('australia');
    expect(result.sourceUrl).toBe(
      'https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/australia/table-api/overview.md',
    );
  });

  it('uses a full URL as-is when the path is already an absolute URL', async () => {
    const fakeFetch = vi.fn(async () => new Response('# Full URL Doc', { status: 200 }));
    const fullUrl =
      'https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/australia/markdown/foo/index.md';
    const result = await fetchDocByPath('australia', fullUrl, fakeFetch as unknown as typeof fetch);
    expect(result.sourceUrl).toBe(fullUrl);
    expect(fakeFetch).toHaveBeenCalledWith(fullUrl);
  });

  it('throws a structured DocsFetchError when fetch rejects (network error)', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      fetchDocByPath('australia', 'x.md', fakeFetch as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(DocsFetchError);
  });

  it('throws a structured DocsFetchError on 404', async () => {
    const fakeFetch = vi.fn(async () => new Response('Not Found', { status: 404 }));
    try {
      await fetchDocByPath('australia', 'missing.md', fakeFetch as unknown as typeof fetch);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DocsFetchError);
      expect((err as DocsFetchError).status).toBe(404);
    }
  });

  it('throws a structured DocsFetchError on non-2xx', async () => {
    const fakeFetch = vi.fn(async () => new Response('Server Error', { status: 500 }));
    try {
      await fetchDocByPath('australia', 'x.md', fakeFetch as unknown as typeof fetch);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DocsFetchError);
      expect((err as DocsFetchError).status).toBe(500);
    }
  });
});
