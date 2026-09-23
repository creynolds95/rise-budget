/**
 * T15 provisioning — the ONLY way a user is created. There is no signup route (SPEC §9).
 *
 *   JWT_SECRET=… pnpm seed:user --email you@example.com --name "Caleb" [--remote] [--origin https://rise.example]
 *
 * Inserts the user row via wrangler and prints a one-time passkey-registration link valid
 * for 10 minutes. JWT_SECRET must match the Worker's secret.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { sign } from 'hono/jwt';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    remote: { type: 'boolean', default: false },
    origin: { type: 'string', default: 'http://localhost:5173' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const secret = process.env['JWT_SECRET'];
if (!values.email || !values.name || !secret) {
  console.error(
    'usage: JWT_SECRET=… pnpm seed:user --email <email> --name <name> [--remote] [--origin <url>]',
  );
  process.exit(1);
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;
const id = randomUUID();
const now = new Date().toISOString();
const settings = JSON.stringify({ rollIncomeVariance: true, appLock: 'off' });
const insert =
  `INSERT INTO user (id, email, display_name, timezone, settings_json, created_at) VALUES ` +
  `(${sql(id)}, ${sql(values.email)}, ${sql(values.name)}, 'America/Chicago', ${sql(settings)}, ${sql(now)});`;

if (values['dry-run']) {
  console.log(`-- dry run, nothing written:\n${insert}`);
} else {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'rise',
      values.remote ? '--remote' : '--local',
      '--command',
      insert,
    ],
    {
      stdio: 'inherit',
    },
  );
}

const nowS = Math.floor(Date.now() / 1000);
const token = await sign({ sub: id, typ: 'register', iat: nowS, exp: nowS + 600 }, secret, 'HS256');
console.log(`\nUser ${values.email} ${values['dry-run'] ? 'would be' : 'was'} created (${id}).`);
console.log(
  `Register your first passkey within 10 minutes:\n\n  ${values.origin}/register#token=${token}\n`,
);
