/**
 * One-command setup for a NEW Rise on your own Cloudflare account (docs/SETUP.md).
 *
 *   pnpm rise:setup                 # from the repo root
 *   pnpm rise:setup --dry-run       # print every step, touch nothing
 *   pnpm rise:setup --new-link      # passkey link expired before you used it
 *
 * Creates the D1 database and R2 bucket, writes the git-ignored wrangler.local.toml (the
 * tracked wrangler.toml keeps its placeholders), builds, migrates, deploys, sets the Worker
 * secrets, creates your user and prints the one-time passkey link, then offers SimpleFIN.
 * Safe to run again: each step skips what already exists.
 *
 * It refuses to run against a Rise that already has a signed-up user, so it can never
 * redeploy, rotate secrets on, or re-seed an install that is in use. Run it on your own
 * machine only: the passkey link it prints is a live login.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  PLACEHOLDER_HOST,
  findDatabaseId,
  findDeployedHost,
  readCount,
  renderLocalConfig,
  secretNames,
} from './setup-lib.ts';

const { values: flags } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'new-link': { type: 'boolean', default: false },
    host: { type: 'string' },
  },
});
const dryRun = flags['dry-run'];

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(API_DIR, '..', '..');
const TEMPLATE = join(API_DIR, 'wrangler.toml');
const LOCAL = join(API_DIR, 'wrangler.local.toml');
const LOCAL_NAME = 'wrangler.local.toml';
const DB_NAME = 'rise';
const WORKER_NAME = 'rise';
const BUCKET = 'rise-backups';

const step = (s: string) => console.log(`\n== ${s}`);
const note = (s: string) => console.log(`   ${s}`);
function fail(s: string): never {
  console.error(`\n✗ ${s}`);
  process.exit(1);
}

/** Runs wrangler from apps/api and returns stdout. Reads only: runs in a dry run too. */
function wranglerRead(args: string[]): string {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Runs a command that changes something. A dry run prints it instead. */
function write(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): string {
  const shown = [cmd, ...args].join(' ');
  if (dryRun) {
    note(`would run: ${shown}`);
    return '';
  }
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? API_DIR,
    encoding: 'utf8',
    input: opts.input,
    stdio: [opts.input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) fail(`Failed: ${shown}`);
  return r.stdout ?? '';
}

/** Questions are all asked before anything runs, so no child process competes for stdin. */
const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
async function ask(q: string, fallback = ''): Promise<string> {
  process.stdout.write(`   ${q}${fallback ? ` [${fallback}]` : ''}: `);
  const next = await lines.next();
  const a = next.done ? '' : String(next.value).trim();
  return a || fallback;
}

// ── 0. Prerequisites ────────────────────────────────────────────────────────────────────
step('Checking your tools');
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(`Node 22 or newer is needed (you have ${process.versions.node}).`);
try {
  const who = wranglerRead(['whoami']);
  if (/not authenticated/i.test(who)) throw new Error();
  note('Signed in to Cloudflare.');
} catch {
  if (dryRun) fail('Run `npx wrangler login` first (from apps/api), then try again.');
  note('Opening a browser to sign in to Cloudflare…');
  if (spawnSync('npx', ['wrangler', 'login'], { cwd: API_DIR, stdio: 'inherit' }).status !== 0) {
    fail('Cloudflare sign-in did not finish.');
  }
}
if (dryRun) note('Dry run: nothing below is changed.');

// ── 1. Database ─────────────────────────────────────────────────────────────────────────
step('Database (D1)');
let databaseId = findDatabaseId(wranglerRead(['d1', 'list', '--json']), DB_NAME);
let existingUsers = 0;
let registeredPasskeys = 0;
if (databaseId) {
  note(`Found "${DB_NAME}" (${databaseId}).`);
  // The guard: a database that already holds a user is an install in use. Leave it alone.
  // The probe config lives in a temp folder, so even this read writes nothing in the repo.
  const probeDir = mkdtempSync(join(tmpdir(), 'rise-setup-'));
  const probe = join(probeDir, 'wrangler.toml');
  writeFileSync(
    probe,
    renderLocalConfig(readFileSync(TEMPLATE, 'utf8'), databaseId, PLACEHOLDER_HOST),
  );
  const count = (table: string) =>
    readCount(
      wranglerRead([
        'd1',
        'execute',
        DB_NAME,
        '--remote',
        '-c',
        probe,
        '--json',
        '--command',
        `SELECT COUNT(*) AS n FROM ${table}`,
      ]),
    );
  try {
    existingUsers = count('user');
    registeredPasskeys = count('credential');
  } catch {
    note('No tables yet (a fresh database).');
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
  if (existingUsers > 0 && !(flags['new-link'] && registeredPasskeys === 0)) {
    fail(
      registeredPasskeys > 0
        ? 'This Cloudflare account already has a Rise in use (a user with a passkey). Setup ' +
            'only creates new installs, so it stopped without changing anything.'
        : 'Your user exists but no passkey is registered yet. Run `pnpm rise:setup --new-link` ' +
            'for a fresh sign-up link.',
    );
  }
}

// ── Your answers, before anything is created ───────────────────────────────────────────
let email = '';
let name = '';
if (existingUsers === 0) {
  step('About you');
  email = await ask('Your email (your sign-in name; Rise never emails it)');
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) fail('That does not look like an email address.');
  name = await ask('Your first name', 'Me');
}
const wantsSimplefin =
  !dryRun &&
  /^y/i.test(
    await ask(
      'Connect your banks at the end? You need a SimpleFIN setup token from ' +
        'beta-bridge.simplefin.org (y/n)',
      'n',
    ),
  );

if (!databaseId) {
  step('Creating the database');
  write('npx', ['wrangler', 'd1', 'create', DB_NAME]);
  databaseId = dryRun
    ? '11111111-1111-1111-1111-111111111111'
    : findDatabaseId(wranglerRead(['d1', 'list', '--json']), DB_NAME);
  if (!databaseId) fail('Created the database but could not read its id back.');
  note(`Created "${DB_NAME}".`);
}

// ── 2. Backup bucket ────────────────────────────────────────────────────────────────────
step('Backup bucket (R2)');
const buckets = wranglerRead(['r2', 'bucket', 'list']);
if (new RegExp(`\\b${BUCKET}\\b`).test(buckets)) {
  note(`Found "${BUCKET}".`);
} else if (dryRun) {
  note(`would run: npx wrangler r2 bucket create ${BUCKET}`);
} else {
  // R2 sometimes refuses once right after it's enabled, then works.
  let ok =
    spawnSync('npx', ['wrangler', 'r2', 'bucket', 'create', BUCKET], {
      cwd: API_DIR,
      stdio: 'inherit',
    }).status === 0;
  if (!ok) {
    note('Retrying once…');
    await new Promise((r) => setTimeout(r, 15_000));
    ok =
      spawnSync('npx', ['wrangler', 'r2', 'bucket', 'create', BUCKET], {
        cwd: API_DIR,
        stdio: 'inherit',
      }).status === 0;
  }
  if (!ok) {
    fail(
      'Could not create the R2 bucket. Turn on R2 in the Cloudflare dashboard (it asks for a ' +
        'payment method; personal use stays free), then run this again.',
    );
  }
}

// ── 3. Local config, build, migrate, deploy ─────────────────────────────────────────────
step('Building and deploying');
const template = readFileSync(TEMPLATE, 'utf8');
let host = flags.host ?? PLACEHOLDER_HOST;
const renderConfig = () => {
  const text = renderLocalConfig(template, databaseId, host);
  if (dryRun) note(`would write apps/api/${LOCAL_NAME} (git-ignored)`);
  else writeFileSync(LOCAL, text);
};
renderConfig();
write('pnpm', ['--filter', '@rise/web', 'build'], { cwd: ROOT });
write('npx', ['wrangler', 'd1', 'migrations', 'apply', DB_NAME, '--remote', '-c', LOCAL_NAME]);
const deployOut = write('npx', ['wrangler', 'deploy', '-c', LOCAL_NAME]);
if (!flags.host && !dryRun) {
  const found = findDeployedHost(deployOut, WORKER_NAME);
  if (found) host = found;
  else host = await ask('Your Worker address, e.g. rise.yourname.workers.dev');
  // Passkeys are bound to this exact host, so the Worker must be told it before sign-up.
  renderConfig();
  write('npx', ['wrangler', 'deploy', '-c', LOCAL_NAME]);
}
note(`Rise is at https://${host}`);

// ── 4. Secrets and your user ────────────────────────────────────────────────────────────
step('Secrets and your account');
const have = dryRun ? [] : secretNames(wranglerRead(['secret', 'list', '-c', LOCAL_NAME]));
if (have.includes('TOTP_KEY')) {
  note('TOTP_KEY already set (never changed once set).');
} else {
  write('npx', ['wrangler', 'secret', 'put', 'TOTP_KEY', '-c', LOCAL_NAME], {
    input: randomBytes(32).toString('base64'),
  });
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';

// A fresh JWT_SECRET signs this run's link. Only ever rotated while nobody has a passkey,
// so it can't sign anyone out.
const jwtSecret = randomBytes(32).toString('hex');
write('npx', ['wrangler', 'secret', 'put', 'JWT_SECRET', '-c', LOCAL_NAME], { input: jwtSecret });
if (existingUsers === 0) {
  write('npx', ['wrangler', 'secret', 'put', 'SIMPLEFIN_OWNER_EMAIL', '-c', LOCAL_NAME], {
    input: email,
  });
}

const seedArgs = [
  '--experimental-strip-types',
  'scripts/seed-user.ts',
  '--remote',
  '--config',
  LOCAL_NAME,
  '--origin',
  `https://${host}`,
  '--timezone',
  timezone,
];
if (existingUsers > 0) seedArgs.push('--link-only');
else seedArgs.push('--email', email, '--name', name);
if (dryRun) seedArgs.push('--dry-run');
// Runs even in a dry run: seed-user has its own --dry-run that writes nothing.
const seed = spawnSync('node', seedArgs, {
  cwd: API_DIR,
  stdio: 'inherit',
  env: { ...process.env, JWT_SECRET: jwtSecret },
});
if (seed.status !== 0) fail('Creating your user failed (see above).');
note('Open that link on your phone within 10 minutes and add Face ID / Touch ID.');

// ── 5. Banks ────────────────────────────────────────────────────────────────────────────
step('Banks (SimpleFIN)');
if (have.includes('SIMPLEFIN_ACCESS_URL')) {
  note('SimpleFIN already connected.');
} else if (dryRun) {
  note('would offer: pnpm simplefin:claim --yes');
} else if (wantsSimplefin) {
  spawnSync(
    'node',
    ['--experimental-strip-types', 'scripts/simplefin-claim.ts', '--yes', '--config', LOCAL_NAME],
    { cwd: API_DIR, stdio: 'inherit' },
  );
} else {
  note('Later: from apps/api run `pnpm simplefin:claim --yes --config wrangler.local.toml`.');
}

rl.close();
step('Done');
note(`Open https://${host}, sign in with your passkey, then Accounts → Sync.`);
note(`Keep apps/api/${LOCAL_NAME}: future deploys use it (see docs/SETUP.md).`);
