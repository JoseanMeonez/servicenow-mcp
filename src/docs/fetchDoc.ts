export type FetchFn = typeof globalThis.fetch;

export interface DocsErrorShape {
  status: number;
  message: string;
}

export class DocsFetchError extends Error {
  readonly status: number;

  constructor(shape: DocsErrorShape) {
    super(shape.message);
    this.name = 'DocsFetchError';
    this.status = shape.status;
  }
}

export interface FetchedDoc {
  markdown: string;
  sourceUrl: string;
}

const REPO = 'ServiceNow/ServiceNowDocs';
const LICENSE_NOTE = `Source: ${REPO} (Apache License 2.0)`;

/**
 * Fetches the raw markdown of a doc path on the given release branch. Never
 * throws an unhandled exception: network errors, timeouts, and non-2xx
 * responses (including 404) all surface as a DocsFetchError with a
 * structured status/message (design ADR #3).
 */
export async function fetchDocByPath(
  release: string,
  path: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<FetchedDoc> {
  // llms.txt entries in this repo use full raw.githubusercontent.com URLs
  // rather than paths relative to the release branch. Accept both: a full
  // URL is used as-is, otherwise it is resolved against the release branch.
  const sourceUrl = /^https?:\/\//i.test(path)
    ? path
    : `https://raw.githubusercontent.com/${REPO}/${release}/${path.replace(/^\/+/, '')}`;

  let res: Response;
  try {
    res = await fetchFn(sourceUrl);
  } catch (err) {
    throw new DocsFetchError({
      status: 0,
      message: `Network error fetching doc "${path}" on release "${release}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  if (!res.ok) {
    throw new DocsFetchError({
      status: res.status,
      message:
        res.status === 404
          ? `Doc not found at "${path}" on release "${release}" (${sourceUrl})`
          : `Failed to fetch doc "${path}" on release "${release}": HTTP ${res.status} (${sourceUrl})`,
    });
  }

  const markdown = await res.text();
  return { markdown: `${markdown}\n\n---\n${LICENSE_NOTE}\nBranch: ${release}\n`, sourceUrl };
}
