import type { Config } from '../config.js';
import { SnApiError } from '../errors.js';
import { authFor, type AuthStrategy } from './auth.js';

export type FetchFn = typeof globalThis.fetch;

export interface SnRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface SnListResult<T> {
  records: T[];
  totalCount?: number;
  hasMore: boolean;
  nextOffset?: number;
}

export interface QueryParams {
  query?: string;
  fields?: string[];
  limit?: number;
  offset?: number;
  displayValue?: 'true' | 'false' | 'all';
}

export interface AggregateParams {
  query?: string;
  groupBy?: string[];
  count?: boolean;
  avgFields?: string[];
  sumFields?: string[];
  minFields?: string[];
  maxFields?: string[];
}

export interface SchemaField {
  name: string;
  label: string;
  mandatory: boolean;
  type: string;
  maxLength?: number;
  reference?: string;
  table: string;
}

interface DictionaryRow {
  element: string;
  column_label: string;
  mandatory: string;
  internal_type: { value: string } | string;
  max_length: string;
  reference: { value: string } | string;
  name: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function refValue(v: { value: string } | string | undefined): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : v.value;
}

export class SnClient {
  constructor(
    private readonly cfg: Config,
    private readonly auth: AuthStrategy = authFor(cfg),
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  async request<T>(
    path: string,
    opts: SnRequestOptions = {},
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(this.cfg.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    // Resolved once per request, outside the try: a broken session file is a
    // configuration error, not a network error, and must not be retried.
    const authHeaders = this.auth(this.cfg);

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: opts.method ?? 'GET',
          headers: {
            ...authHeaders,
            Accept: 'application/json',
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new SnApiError({
            status: 0,
            message: `Request timed out after ${this.cfg.requestTimeoutMs}ms: ${opts.method ?? 'GET'} ${path}`,
          });
        }
        throw new SnApiError({
          status: 0,
          message: `Network error on ${opts.method ?? 'GET'} ${path}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (res.ok) {
        const text = await res.text();
        if (!text) return { data: undefined as T, headers: res.headers };
        try {
          return { data: JSON.parse(text) as T, headers: res.headers };
        } catch {
          throw new SnApiError({
            status: res.status,
            message: this.nonJsonMessage(res.status),
            detail: text.slice(0, 300),
          });
        }
      }

      const error = await this.normalizeError(res);
      if (!isRetryable(res.status) || attempt >= this.cfg.retryMaxAttempts) throw error;
      await sleep(this.backoffMs(res, attempt));
    }
  }

  private async normalizeError(res: Response): Promise<SnApiError> {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: { message?: string; detail?: string } };
      let detail = body.error?.detail ?? undefined;
      if (res.status === 401) {
        const hint = this.unauthorizedHint();
        detail = detail ? `${detail} — ${hint}` : hint;
      }
      return new SnApiError({
        status: res.status,
        message: body.error?.message ?? res.statusText ?? `HTTP ${res.status}`,
        detail,
      });
    } catch {
      return new SnApiError({
        status: res.status,
        message: this.nonJsonMessage(res.status),
        detail: text.slice(0, 300),
      });
    }
  }

  /**
   * A non-JSON body almost always means an HTML login page: the instance
   * bounced the request to its identity provider instead of serving the API.
   */
  private nonJsonMessage(status: number): string {
    if (this.cfg.authMode === 'session') {
      return (
        `Non-JSON response (status ${status}); the SSO session has most likely expired — ` +
        `recapture it into "${this.cfg.sessionFile}"`
      );
    }
    return `Non-JSON response (status ${status}); possible SSO/MFA redirect instead of Basic Auth`;
  }

  private unauthorizedHint(): string {
    if (this.cfg.authMode === 'session') {
      return (
        'Session auth: the SSO session has expired, or "cookie" and "userToken" (g_ck) are ' +
        'not from the same browser session — ServiceNow requires both on every request, ' +
        `reads included. Recapture them into "${this.cfg.sessionFile}" (see README, ` +
        '"SSO session mode").'
      );
    }
    return (
      'If the credentials are correct, verify the instance user setup: the user needs the ' +
      '"snc_basic_auth_api_access" role and internal_integration_user=true (see README, ' +
      '"Instance user setup").'
    );
  }

  private backoffMs(res: Response, attempt: number): number {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return seconds * 1000;
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    }
    const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
    return base + Math.floor(Math.random() * 250);
  }

  async queryTable<T = Record<string, unknown>>(
    table: string,
    params: QueryParams = {},
  ): Promise<SnListResult<T>> {
    const limit = Math.min(params.limit ?? this.cfg.defaultLimit, this.cfg.maxLimit);
    const offset = params.offset ?? 0;
    const { data, headers } = await this.request<{ result: T[] }>(`/api/now/table/${table}`, {
      query: {
        sysparm_query: params.query,
        sysparm_fields: params.fields?.join(','),
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: params.displayValue,
      },
    });
    const records = data.result;
    const totalHeader = headers.get('x-total-count');
    const totalCount = totalHeader !== null ? Number(totalHeader) : undefined;
    const linkHeader = headers.get('link') ?? '';
    const hasMore =
      /rel="next"/.test(linkHeader) ||
      (totalCount !== undefined && offset + records.length < totalCount) ||
      (totalCount === undefined && !linkHeader && records.length === limit);
    return {
      records,
      totalCount,
      hasMore,
      nextOffset: hasMore ? offset + records.length : undefined,
    };
  }

  async getRecord<T = Record<string, unknown>>(
    table: string,
    sysId: string,
    fields?: string[],
  ): Promise<T> {
    const { data } = await this.request<{ result: T }>(`/api/now/table/${table}/${sysId}`, {
      query: { sysparm_fields: fields?.join(',') },
    });
    return data.result;
  }

  async createRecord<T = Record<string, unknown>>(
    table: string,
    fields: Record<string, unknown>,
  ): Promise<T> {
    const { data } = await this.request<{ result: T }>(`/api/now/table/${table}`, {
      method: 'POST',
      body: fields,
    });
    return data.result;
  }

  async updateRecord<T = Record<string, unknown>>(
    table: string,
    sysId: string,
    fields: Record<string, unknown>,
  ): Promise<T> {
    const { data } = await this.request<{ result: T }>(`/api/now/table/${table}/${sysId}`, {
      method: 'PATCH',
      body: fields,
    });
    return data.result;
  }

  async deleteRecord(table: string, sysId: string): Promise<void> {
    await this.request<void>(`/api/now/table/${table}/${sysId}`, { method: 'DELETE' });
  }

  async aggregate(table: string, params: AggregateParams = {}): Promise<Record<string, unknown>[]> {
    const { data } = await this.request<{ result: unknown }>(`/api/now/stats/${table}`, {
      query: {
        sysparm_query: params.query,
        sysparm_group_by: params.groupBy?.join(','),
        sysparm_count: params.count,
        sysparm_avg_fields: params.avgFields?.join(','),
        sysparm_sum_fields: params.sumFields?.join(','),
        sysparm_min_fields: params.minFields?.join(','),
        sysparm_max_fields: params.maxFields?.join(','),
      },
    });
    const result = data.result;
    return (Array.isArray(result) ? result : [result]) as Record<string, unknown>[];
  }

  /**
   * Field list from sys_dictionary, walking the table hierarchy via
   * sys_db_object so inherited fields (e.g. incident -> task) are included.
   * Portable to any instance/PDI, unlike /api/now/doc/table/schema which
   * needs extra plugins. Virtual/computed fields may be missing.
   */
  async getTableSchema(table: string): Promise<SchemaField[]> {
    const tables = await this.getTableHierarchy(table);
    const rows = await this.queryTable<DictionaryRow>('sys_dictionary', {
      query: `nameIN${tables.join(',')}^element!=NULL^ORDERBYelement`,
      fields: [
        'element',
        'column_label',
        'mandatory',
        'internal_type',
        'max_length',
        'reference',
        'name',
      ],
      limit: this.cfg.maxLimit,
    });
    const seen = new Set<string>();
    const schema: SchemaField[] = [];
    // hierarchy order: child first, so a child override wins over the parent row
    for (const tbl of tables) {
      for (const row of rows.records) {
        if (row.name !== tbl || seen.has(row.element)) continue;
        seen.add(row.element);
        schema.push({
          name: row.element,
          label: row.column_label,
          mandatory: row.mandatory === 'true',
          type: refValue(row.internal_type),
          maxLength: row.max_length ? Number(row.max_length) : undefined,
          reference: refValue(row.reference) || undefined,
          table: row.name,
        });
      }
    }
    schema.sort((a, b) => a.name.localeCompare(b.name));
    return schema;
  }

  private async getTableHierarchy(table: string): Promise<string[]> {
    const tables: string[] = [table];
    let current = table;
    for (let depth = 0; depth < 10; depth++) {
      const res = await this.queryTable<{ 'super_class.name': string }>('sys_db_object', {
        query: `name=${current}`,
        fields: ['super_class.name'],
        limit: 1,
      });
      const parent = res.records[0]?.['super_class.name'];
      if (!parent || tables.includes(parent)) break;
      tables.push(parent);
      current = parent;
    }
    return tables;
  }
}
