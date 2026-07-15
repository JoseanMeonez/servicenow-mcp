import type { BestPracticeEntry } from './types.js';

export const UPDATE_SETS_PRACTICES: BestPracticeEntry[] = [
  {
    id: 'update-sets-avoid-default-set',
    area: 'update-sets',
    title: 'Never make configuration changes in the "Default" update set',
    guidance:
      'The "Default" update set is not meant to hold trackable, movable changes — it is a ' +
      'catch-all that is awkward to migrate between instances. Always switch to a ' +
      'purpose-named update set (see `servicenow_set_current_update_set`) before creating ' +
      'or updating configuration records, so the change set can be captured, reviewed, and ' +
      'promoted as a unit.',
    appliesTo: { operations: ['create', 'update'] },
    riskLevel: 'medium',
  },
  {
    id: 'update-sets-one-purpose-per-set',
    area: 'update-sets',
    title: 'Keep one update set scoped to one logical change',
    guidance:
      'Mixing unrelated changes into a single update set makes it hard to review, hard to ' +
      'roll back independently, and risks accidentally promoting unrelated work together. ' +
      'Name update sets after the specific feature or fix they contain, and create a new one ' +
      'when starting unrelated work.',
    appliesTo: {},
    riskLevel: 'low',
  },
];
