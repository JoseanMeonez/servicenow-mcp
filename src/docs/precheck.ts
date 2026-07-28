import { sign, type PrecheckOperation, type RiskLevel } from './token.js';
import { BEST_PRACTICES, type BestPracticeEntry } from './bestPractices/index.js';

export interface PrecheckReport {
  table: string;
  operation: PrecheckOperation;
  riskLevel: RiskLevel;
  matches: BestPracticeEntry[];
  precheckToken?: string;
}

const TASK_FAMILY_TABLES = new Set(['task', 'incident', 'problem', 'change_request', 'sc_task']);

/**
 * Derives a risk level for the given table + operation using the ordered
 * rule table from design ADR #6. Checked in order; first match (after the
 * delete escalation) determines the level.
 */
function deriveRiskLevel(table: string, operation: PrecheckOperation): RiskLevel {
  let level: RiskLevel = 'low';

  if (/^sys_/i.test(table)) {
    level = 'high';
  } else if (/^cmdb_/i.test(table)) {
    level = 'high';
  } else if (TASK_FAMILY_TABLES.has(table.toLowerCase()) || /_task$/i.test(table)) {
    level = 'medium';
  } else if (/^u_/i.test(table) || /^x_/i.test(table)) {
    level = 'low';
  }

  if (operation === 'delete' && level !== 'high') {
    level = 'medium';
  }

  return level;
}

function tableMatches(pattern: string, table: string): boolean {
  const normalizedTable = table.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  if (normalizedPattern.endsWith('*')) {
    return normalizedTable.startsWith(normalizedPattern.slice(0, -1));
  }
  return normalizedTable === normalizedPattern;
}

function entryMatches(
  entry: BestPracticeEntry,
  table: string,
  operation: PrecheckOperation,
): boolean {
  const tablesOk =
    !entry.appliesTo.tables ||
    entry.appliesTo.tables.length === 0 ||
    entry.appliesTo.tables.some((pattern) => tableMatches(pattern, table));
  const operationsOk =
    !entry.appliesTo.operations ||
    entry.appliesTo.operations.length === 0 ||
    entry.appliesTo.operations.includes(operation);
  return tablesOk && operationsOk;
}

/**
 * Analyzes an intended write operation, returning a risk level and matching
 * curated best-practice entries. Issues a signed precheck token only when
 * risk is medium or high (design ADR #6) — pure/no I/O, safe to call
 * repeatedly.
 */
export function analyzePrecheck(table: string, operation: PrecheckOperation): PrecheckReport {
  const riskLevel = deriveRiskLevel(table, operation);
  const matches = BEST_PRACTICES.filter((entry) => entryMatches(entry, table, operation));

  const report: PrecheckReport = { table, operation, riskLevel, matches };
  if (riskLevel !== 'low') {
    report.precheckToken = sign({ table, operation, riskLevel });
  }
  return report;
}
