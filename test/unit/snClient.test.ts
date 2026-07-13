import { describe, it, expect, vi } from 'vitest';
import type { Config } from '../../src/config.js';
import { SnClient, type FetchFn } from '../../src/client/snClient.js';
import { SnApiError } from '../../src/errors.js';

const cfg: Config = {
  baseUrl: 'https://test.service-now.com',
  username: 'admin',
  password: 'secret',
  allowWrites: false,
  requireUpdateSet: true,
  defaultLimit: 50,
  maxLimit: 500,
  requestTimeoutMs: 30000,
  retryMaxAttempts: 3,
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function clientWith(fetchFn: FetchFn, overrides: Partial<Config> = {}): SnClient {
  return new SnClient({ ...cfg, ...overrides }, undefined, fetchFn);
}

describe('SnClient.queryTable', () => {
  it('builds sysparm params and returns pagination info', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: [{ sys_id: 'a' }, { sys_id: 'b' }] }, 200, { 'X-Total-Count': '10' }),
    );
    const result = await clientWith(fetchFn).queryTable('incident', {
      query: 'active=true',
      fields: ['sys_id', 'short_description'],
      limit: 2,
      offset: 0,
    });

    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/now/table/incident');
    expect(url.searchParams.get('sysparm_query')).toBe('active=true');
    expect(url.searchParams.get('sysparm_fields')).toBe('sys_id,short_description');
    expect(url.searchParams.get('sysparm_limit')).toBe('2');

    expect(result.records).toHaveLength(2);
    expect(result.totalCount).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(2);
  });

  it('sends Basic Auth header', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: [] }));
    await clientWith(fetchFn).queryTable('incident');
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`);
  });

  it('detects hasMore from the Link header', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ result: [{ sys_id: 'a' }] }, 200, {
        Link: '<https://test.service-now.com/api/now/table/incident?sysparm_offset=1>;rel="next"',
      }),
    );
    const result = await clientWith(fetchFn).queryTable('incident', { limit: 1 });
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(1);
  });

  it('clamps limit to maxLimit', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: [] }));
    await clientWith(fetchFn, { maxLimit: 100 }).queryTable('incident', { limit: 9999 });
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.searchParams.get('sysparm_limit')).toBe('100');
  });
});

describe('SnClient retry behavior', () => {
  it('retries on 429 honoring Retry-After', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Rate limit' } }, 429, { 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(jsonResponse({ result: [] }));
    const result = await clientWith(fetchFn).queryTable('incident');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.records).toEqual([]);
  });

  it('retries on 5xx and gives up after max attempts', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { message: 'boom' } }, 503, { 'Retry-After': '0' }),
    );
    await expect(clientWith(fetchFn).queryTable('incident')).rejects.toMatchObject({
      status: 503,
      message: 'boom',
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 4xx and normalizes the ServiceNow error body', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { error: { message: 'Invalid table', detail: 'no such table x_foo' }, status: 'failure' },
        400,
      ),
    );
    await expect(clientWith(fetchFn).queryTable('x_foo')).rejects.toMatchObject({
      status: 400,
      message: 'Invalid table',
      detail: 'no such table x_foo',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('SnClient error normalization', () => {
  it('appends the instance-user-setup hint on 401 JSON errors', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: 'User is not authenticated',
            detail: 'Required to provide Auth information',
          },
        },
        401,
      ),
    );
    await expect(clientWith(fetchFn).queryTable('incident')).rejects.toMatchObject({
      status: 401,
      detail: expect.stringContaining('snc_basic_auth_api_access'),
    });
  });

  it('flags non-JSON error bodies as a possible SSO/MFA redirect', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>login</html>', { status: 401 }));
    await expect(clientWith(fetchFn).queryTable('incident')).rejects.toThrow(/SSO\/MFA redirect/);
  });

  it('flags non-JSON success bodies as a possible SSO/MFA redirect', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>portal</html>', { status: 200 }));
    await expect(clientWith(fetchFn).queryTable('incident')).rejects.toThrow(/SSO\/MFA redirect/);
  });

  it('wraps network failures in SnApiError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(clientWith(fetchFn).queryTable('incident')).rejects.toBeInstanceOf(SnApiError);
  });
});

describe('SnClient writes', () => {
  it('POSTs JSON on createRecord', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: { sys_id: 'new1' } }, 201));
    const record = await clientWith(fetchFn).createRecord('incident', {
      short_description: 'test',
    });
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ short_description: 'test' });
    expect(record).toEqual({ sys_id: 'new1' });
  });

  it('handles empty 204 body on deleteRecord', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      clientWith(fetchFn).deleteRecord('incident', 'a'.repeat(32)),
    ).resolves.toBeUndefined();
  });
});

describe('SnClient.getTableSchema', () => {
  it('walks the hierarchy and dedupes overridden fields (child wins)', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes('sys_db_object')) {
        const q = url.searchParams.get('sysparm_query') ?? '';
        if (q.includes('name=incident'))
          return jsonResponse({ result: [{ 'super_class.name': 'task' }] });
        return jsonResponse({ result: [{ 'super_class.name': '' }] });
      }
      return jsonResponse({
        result: [
          {
            element: 'short_description',
            column_label: 'Short description',
            mandatory: 'true',
            internal_type: { value: 'string' },
            max_length: '160',
            reference: '',
            name: 'incident',
          },
          {
            element: 'short_description',
            column_label: 'Short description (task)',
            mandatory: 'false',
            internal_type: { value: 'string' },
            max_length: '160',
            reference: '',
            name: 'task',
          },
          {
            element: 'assigned_to',
            column_label: 'Assigned to',
            mandatory: 'false',
            internal_type: { value: 'reference' },
            max_length: '32',
            reference: { value: 'sys_user' },
            name: 'task',
          },
        ],
      });
    });
    const schema = await clientWith(fetchFn as FetchFn).getTableSchema('incident');
    expect(schema).toHaveLength(2);
    const shortDesc = schema.find((f) => f.name === 'short_description');
    expect(shortDesc?.table).toBe('incident');
    expect(shortDesc?.mandatory).toBe(true);
    const assignedTo = schema.find((f) => f.name === 'assigned_to');
    expect(assignedTo?.reference).toBe('sys_user');
  });
});
