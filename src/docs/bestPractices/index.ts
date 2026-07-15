import { CONTRACTS_PRACTICES } from './contracts.js';
import { CODING_STANDARDS_PRACTICES } from './codingStandards.js';
import { RECORD_OPS_PRACTICES } from './recordOps.js';
import { UPDATE_SETS_PRACTICES } from './updateSets.js';

export type { BestPracticeEntry, BestPracticeArea, BestPracticeOperation } from './types.js';

export const BEST_PRACTICES = [
  ...UPDATE_SETS_PRACTICES,
  ...RECORD_OPS_PRACTICES,
  ...CONTRACTS_PRACTICES,
  ...CODING_STANDARDS_PRACTICES,
];
