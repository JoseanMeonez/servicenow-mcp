import type { BestPracticeEntry } from './types.js';

export const CONTRACTS_PRACTICES: BestPracticeEntry[] = [
  {
    id: 'contracts-avoid-breaking-field-removal',
    area: 'contracts',
    title: 'Avoid removing or renaming fields consumers depend on',
    guidance:
      'Removing or renaming a table field is a breaking change for any integration, ' +
      'business rule, or client script referencing it by name. Prefer deprecating a field ' +
      '(stop writing to it, document the replacement) over deleting it outright. If removal ' +
      'is unavoidable, search for references across business rules, client scripts, UI ' +
      'policies, and integrations before deleting.',
    appliesTo: { operations: ['delete', 'update'] },
    riskLevel: 'high',
  },
  {
    id: 'contracts-additive-changes-preferred',
    area: 'contracts',
    title: 'Prefer additive schema changes',
    guidance:
      'Adding a new field is almost always safer than changing the type or meaning of an ' +
      'existing one. Existing consumers keep working, and the new field can be adopted ' +
      'incrementally. Reserve destructive or type-changing edits for cases where the ' +
      'existing field is provably unused.',
    appliesTo: { operations: ['create', 'update'] },
    riskLevel: 'medium',
  },
];
