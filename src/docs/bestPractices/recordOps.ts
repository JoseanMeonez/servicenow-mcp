import type { BestPracticeEntry } from './types.js';

export const RECORD_OPS_PRACTICES: BestPracticeEntry[] = [
  {
    id: 'record-ops-sys-table-caution',
    area: 'record-ops',
    title: 'Treat sys_* table writes as platform-level changes',
    guidance:
      'Tables prefixed `sys_` (e.g. `sys_dictionary`, `sys_script`, `sys_security_acl`) ' +
      'configure the platform itself, not application data. A bad write here can affect ' +
      'every user and every application on the instance. Confirm the specific record and ' +
      'field before writing, and prefer a scoped application table when the goal is ' +
      'storing application data rather than reconfiguring the platform.',
    appliesTo: { tables: ['sys_*'] },
    riskLevel: 'high',
  },
  {
    id: 'record-ops-cmdb-relationship-integrity',
    area: 'record-ops',
    title: 'Preserve CMDB relationship integrity on cmdb_* writes',
    guidance:
      'CMDB tables (`cmdb_ci*`) participate in relationship and dependency graphs used by ' +
      'discovery, service mapping, and change/impact analysis. Deleting or altering a CI ' +
      'without checking its relationships can silently break those graphs. Prefer marking ' +
      'CIs as retired/inactive over hard deletion, and review `cmdb_rel_ci` entries before ' +
      'removing a CI.',
    appliesTo: { tables: ['cmdb_*'] },
    riskLevel: 'high',
  },
  {
    id: 'record-ops-task-family-workflow-side-effects',
    area: 'record-ops',
    title: 'Task-family writes can trigger workflow and notification side effects',
    guidance:
      'Tables in the task family (`task`, `incident`, `problem`, `change_request`, ' +
      '`sc_task`, and tables ending in `_task`) commonly have business rules, workflows, ' +
      'and notifications attached to state and assignment changes. Writing directly via the ' +
      'API bypasses any UI-only guardrails but not server-side business rules — expect ' +
      'those side effects to fire, and verify state-transition validity before writing.',
    appliesTo: { tables: ['task', 'incident', 'problem', 'change_request', 'sc_task'] },
    riskLevel: 'medium',
  },
  {
    id: 'record-ops-delete-is-irreversible',
    area: 'record-ops',
    title: 'Deletes are not soft by default — confirm before deleting',
    guidance:
      'Unlike many task-family workflows that use a "closed"/"cancelled" state, a direct ' +
      'table API delete permanently removes the record unless the table has an audit or ' +
      'soft-delete mechanism configured. Prefer setting an inactive/cancelled state over a ' +
      'hard delete whenever the table supports it, and always confirm the target sys_id ' +
      'before deleting.',
    appliesTo: { operations: ['delete'] },
    riskLevel: 'high',
  },
  {
    id: 'record-ops-custom-table-lower-risk',
    area: 'record-ops',
    title: 'Custom application tables are generally lower risk',
    guidance:
      'Tables with a custom prefix (`u_` or an application scope prefix like `x_`) are ' +
      'typically application-specific data with fewer cross-cutting dependencies than ' +
      'platform or CMDB tables. Standard care still applies (validate required fields, ' +
      'confirm update-set scope), but the blast radius of a mistake is usually contained to ' +
      'that application.',
    appliesTo: { tables: ['u_*', 'x_*'] },
    riskLevel: 'low',
  },
];
