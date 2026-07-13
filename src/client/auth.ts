import type { Config } from '../config.js';

/**
 * An auth strategy returns the HTTP headers that authenticate a request.
 * v1 ships Basic Auth only; an OAuth or browser-session strategy can be
 * added later without touching the client.
 */
export type AuthStrategy = (cfg: Config) => Record<string, string>;

export const basicAuth: AuthStrategy = (cfg) => ({
  Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`,
});
