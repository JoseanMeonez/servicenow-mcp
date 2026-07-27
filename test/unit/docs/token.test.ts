import { describe, it, expect, vi } from 'vitest';
import { sign, verify } from '../../../src/docs/token.js';

describe('token', () => {
  it('round-trips a signed token', () => {
    const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
    const result = verify(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.table).toBe('incident');
      expect(result.payload.operation).toBe('update');
      expect(result.payload.riskLevel).toBe('medium');
    }
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
      vi.advanceTimersByTime(11 * 60 * 1000);
      const result = verify(token);
      expect(result).toMatchObject({ valid: false, reason: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a tampered payload', () => {
    const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
    const [payloadEncoded, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
    payload.table = 'sys_dictionary';
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${signature}`;
    expect(verify(tamperedToken)).toMatchObject({ valid: false, reason: 'signature-mismatch' });
  });

  it('rejects a tampered signature', () => {
    const token = sign({ table: 'incident', operation: 'update', riskLevel: 'medium' });
    const [payloadEncoded] = token.split('.');
    const tamperedToken = `${payloadEncoded}.deadbeef`;
    expect(verify(tamperedToken)).toMatchObject({ valid: false, reason: 'signature-mismatch' });
  });

  it('rejects a malformed token', () => {
    expect(verify('not-a-valid-token')).toMatchObject({ valid: false, reason: 'malformed' });
  });
});
