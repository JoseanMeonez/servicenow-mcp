import { describe, it, expect } from 'vitest';
import { analyzePrecheck } from '../../../src/docs/precheck.js';
import { verify } from '../../../src/docs/token.js';

describe('analyzePrecheck', () => {
  it('flags sys_* tables as high risk', () => {
    const report = analyzePrecheck('sys_dictionary', 'create');
    expect(report.riskLevel).toBe('high');
  });

  it('flags cmdb_* tables as high risk', () => {
    const report = analyzePrecheck('cmdb_ci_server', 'update');
    expect(report.riskLevel).toBe('high');
  });

  it('flags task-family tables as medium risk', () => {
    expect(analyzePrecheck('incident', 'update').riskLevel).toBe('medium');
    expect(analyzePrecheck('sc_task', 'update').riskLevel).toBe('medium');
    expect(analyzePrecheck('custom_task', 'update').riskLevel).toBe('medium');
  });

  it('flags custom-prefix tables as low risk', () => {
    expect(analyzePrecheck('u_my_table', 'create').riskLevel).toBe('low');
    expect(analyzePrecheck('x_acme_widget', 'create').riskLevel).toBe('low');
  });

  it('defaults to low risk when no rule matches', () => {
    expect(analyzePrecheck('my_custom_table', 'create').riskLevel).toBe('low');
  });

  it('escalates delete operations to at least medium risk', () => {
    expect(analyzePrecheck('my_custom_table', 'delete').riskLevel).toBe('medium');
  });

  it('keeps high risk on delete when the table rule is already high', () => {
    expect(analyzePrecheck('sys_dictionary', 'delete').riskLevel).toBe('high');
  });

  it('matches best-practice entries by table and operation', () => {
    const report = analyzePrecheck('sys_dictionary', 'create');
    expect(report.matches.some((entry) => entry.id === 'record-ops-sys-table-caution')).toBe(true);
  });

  it('returns curated best practices with no error on low-risk fallback', () => {
    const report = analyzePrecheck('my_custom_table', 'create');
    expect(report.riskLevel).toBe('low');
    expect(Array.isArray(report.matches)).toBe(true);
  });

  it('issues a token for medium/high risk', () => {
    const medium = analyzePrecheck('incident', 'update');
    expect(medium.precheckToken).toBeDefined();
    const high = analyzePrecheck('sys_dictionary', 'create');
    expect(high.precheckToken).toBeDefined();
  });

  it('does not issue a token for low risk', () => {
    const report = analyzePrecheck('my_custom_table', 'create');
    expect(report.precheckToken).toBeUndefined();
  });

  it('binds the issued token to the table and operation', () => {
    const report = analyzePrecheck('incident', 'update');
    expect(report.precheckToken).toBeDefined();
    const result = verify(report.precheckToken!);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.table).toBe('incident');
      expect(result.payload.operation).toBe('update');
    }
  });
});
