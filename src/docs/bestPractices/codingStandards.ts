import type { BestPracticeEntry } from './types.js';

export const CODING_STANDARDS_PRACTICES: BestPracticeEntry[] = [
  {
    id: 'coding-standards-encoded-query-safety',
    area: 'coding-standards',
    title: 'Build encoded queries carefully, never by string-concatenating user input',
    guidance:
      "Encoded queries (e.g. `active=true^priority=1`) are ServiceNow's query language, not " +
      'SQL, but they are still parsed server-side and can be manipulated by unsanitized ' +
      'input in the same spirit as injection. Validate or escape any user-supplied value ' +
      'used to build a query segment, and prefer parameterizing known-safe fields over ' +
      'accepting a raw encoded-query fragment from an untrusted source.',
    appliesTo: {},
    riskLevel: 'medium',
  },
  {
    id: 'coding-standards-avoid-sys-id-guessing',
    area: 'coding-standards',
    title: 'Resolve sys_id via query, never assume or hardcode one',
    guidance:
      'sys_id values are instance-specific (generated per record, per instance). Scripts, ' +
      'integrations, or fixtures that hardcode a sys_id from one instance will silently ' +
      'target the wrong record — or nothing — on another. Always resolve the sys_id via a ' +
      'query against a stable field (e.g. name, number, correlation id) at runtime.',
    appliesTo: {},
    riskLevel: 'low',
  },
];
