export type FetchFn = typeof globalThis.fetch;

export interface LlmsIndexEntry {
  title: string;
  path: string;
  section: string;
  description?: string;
}

export interface LlmsIndex {
  entries: LlmsIndexEntry[];
}

export interface SearchResult {
  title: string;
  path: string;
  section: string;
  snippet?: string;
}

const SECTION_RE = /^##\s+(.+?)\s*$/;
const ENTRY_RE = /^-\s+\[(.+?)\]\((.+?)\)(?::\s*(.+))?$/;

/**
 * Parses an llms.txt document (https://llmstxt.org spec): H1 title, blockquote
 * summary, and H2 sections each containing a bullet list of links. Tolerant
 * of unmatched/malformed lines — they are simply skipped.
 */
export function parseLlmsIndex(text: string): LlmsIndex {
  const entries: LlmsIndexEntry[] = [];
  let currentSection = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const sectionMatch = SECTION_RE.exec(rawLine);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    const entryMatch = ENTRY_RE.exec(rawLine);
    if (entryMatch) {
      const [, title, path, description] = entryMatch;
      entries.push({ title, path, section: currentSection, description });
    }
  }

  return { entries };
}

/**
 * Fetches the llms.txt index for a given release branch. No caching: every
 * call performs a fresh fetch (design ADR #2, stateless-server hard rule).
 */
export async function fetchLlmsIndex(
  release: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/${release}/llms.txt`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch llms.txt for release "${release}": HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * Case-insensitive substring match against title + description + section
 * name. Score = number of query keywords matched, tie-broken by earliest
 * match position. Returns the top N (default 10) results.
 */
export function searchLlmsIndex(index: LlmsIndex, query: string, topN = 10): SearchResult[] {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (keywords.length === 0) return [];

  const scored: { entry: LlmsIndexEntry; score: number; position: number }[] = [];
  for (const entry of index.entries) {
    const haystack = `${entry.title} ${entry.description ?? ''} ${entry.section}`.toLowerCase();
    let score = 0;
    let earliestPosition = Infinity;
    for (const keyword of keywords) {
      const position = haystack.indexOf(keyword);
      if (position >= 0) {
        score++;
        if (position < earliestPosition) earliestPosition = position;
      }
    }
    if (score > 0) {
      scored.push({ entry, score, position: earliestPosition });
    }
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.position - b.position));

  return scored.slice(0, topN).map(({ entry }) => ({
    title: entry.title,
    path: entry.path,
    section: entry.section,
    snippet: entry.description,
  }));
}
