import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type PrecheckOperation = 'create' | 'update' | 'delete';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface PrecheckTokenPayload {
  table: string;
  operation: PrecheckOperation;
  riskLevel: RiskLevel;
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { valid: true; payload: PrecheckTokenPayload }
  | { valid: false; reason: 'malformed' | 'signature-mismatch' | 'expired' };

const TOKEN_TTL_SECONDS = 600;

// Per-process secret. Not exported, not persisted. Tokens signed by one
// process are rejected by another process (see design ADR #1) — this is an
// accepted tradeoff for a stateless, single-process-per-instance server.
const secret = randomBytes(32);

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function signPayload(payloadEncoded: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(payloadEncoded).digest());
}

/**
 * Issues a compact HMAC-signed token binding table + operation, valid for
 * ~10 minutes. Format: base64url(JSON payload) + "." + base64url(signature).
 */
export function sign(input: { table: string; operation: PrecheckOperation; riskLevel: RiskLevel }): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: PrecheckTokenPayload = {
    table: input.table,
    operation: input.operation,
    riskLevel: input.riskLevel,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

/**
 * Verifies a token's signature and expiry. Does not check table/operation
 * binding against a request — callers compare payload.table/operation
 * themselves (see gate.ts assertPrecheckToken).
 */
export function verify(token: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [payloadEncoded, signature] = parts;

  const expectedSignature = signPayload(payloadEncoded);
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { valid: false, reason: 'signature-mismatch' };
  }

  let payload: PrecheckTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as PrecheckTokenPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (
    typeof payload.table !== 'string' ||
    typeof payload.operation !== 'string' ||
    typeof payload.riskLevel !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) return { valid: false, reason: 'expired' };

  return { valid: true, payload };
}
