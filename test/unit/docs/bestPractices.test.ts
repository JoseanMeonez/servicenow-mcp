import { describe, it, expect } from 'vitest';
import { BEST_PRACTICES } from '../../../src/docs/bestPractices/index.js';
import type { BestPracticeArea } from '../../../src/docs/bestPractices/types.js';

const AREAS: BestPracticeArea[] = ['update-sets', 'record-ops', 'contracts', 'coding-standards'];
const RISK_LEVELS = new Set(['low', 'medium', 'high']);

describe('BEST_PRACTICES', () => {
  it('flattens all four area modules', () => {
    expect(BEST_PRACTICES.length).toBeGreaterThanOrEqual(4);
  });

  it('has at least one entry per area', () => {
    for (const area of AREAS) {
      const matches = BEST_PRACTICES.filter((entry) => entry.area === area);
      expect(matches.length, `expected at least one entry for area "${area}"`).toBeGreaterThan(0);
    }
  });

  it('uses only typed area and riskLevel values', () => {
    for (const entry of BEST_PRACTICES) {
      expect(AREAS).toContain(entry.area);
      expect(RISK_LEVELS.has(entry.riskLevel)).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = BEST_PRACTICES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
