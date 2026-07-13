#!/usr/bin/env node
/**
 * Create a per-instance profile file and print the Claude Code registration command.
 *
 * Usage:
 *   npm run add-instance -- <name> <https://instance.service-now.com> <username> <password>
 *
 * Writes instances/<name>.env (gitignored). Note: the password is passed as a CLI
 * argument and may land in your shell history; clear it if that matters to you.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [name, url, username, password] = process.argv.slice(2);

if (!name || !url || !username || !password) {
  console.error(
    'Usage: npm run add-instance -- <name> <https://instance.service-now.com> <username> <password>',
  );
  process.exit(1);
}
if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
  console.error('Instance name may only contain letters, digits, dot, dash, underscore.');
  process.exit(1);
}
if (!url.startsWith('https://')) {
  console.error('Instance URL must start with https://');
  process.exit(1);
}
if (password.includes('"')) {
  console.error('Passwords containing double quotes are not supported by the .env format.');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'instances');
mkdirSync(dir, { recursive: true });

const file = join(dir, `${name}.env`);
if (existsSync(file)) {
  console.error(`Refusing to overwrite existing profile: ${file}`);
  process.exit(1);
}

writeFileSync(
  file,
  `SN_BASE_URL=${url.replace(/\/+$/, '')}\nSN_USERNAME=${username}\nSN_PASSWORD="${password}"\n`,
  { mode: 0o600 },
);

const toPosix = (p) => p.replace(/\\/g, '/');
console.log(`Wrote ${file}`);
console.log('\nRegister with Claude Code (user scope = available in every project):');
console.log(
  `  claude mcp add --scope user servicenow-${name} -- node --env-file=${toPosix(file)} ${toPosix(join(root, 'dist', 'index.js'))}`,
);
console.log(
  '\nReminder: the API user needs the snc_basic_auth_api_access role and internal_integration_user=true (see README "Instance user setup").',
);
