/**
 * T27 — the one-time SimpleFIN setup (SPEC §6.1, ARCHITECTURE §5). Not a route.
 *
 *   pnpm simplefin:claim --yes            # paste the setup token when asked
 *
 * The setup token is single-use: claiming it (here, or by opening its URL in a browser)
 * burns it. This script claims it and pipes the resulting access URL straight into
 * `wrangler secret put SIMPLEFIN_ACCESS_URL`, so the URL never hits the screen, a file, or
 * shell history. Pass --print only if you must see it (e.g. wrangler isn't logged in).
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    print: { type: 'boolean', default: false },
  },
});

const rl = createInterface({ input: process.stdin, output: process.stderr });
const token = (await rl.question('SimpleFIN setup token: ')).trim();
rl.close();

let claimUrl: URL;
try {
  claimUrl = new URL(Buffer.from(token, 'base64').toString('utf8').trim());
  if (claimUrl.protocol !== 'https:') throw new Error('not https');
} catch {
  console.error('That does not look like a SimpleFIN setup token.');
  process.exit(1);
}

console.error(`Claim host: ${claimUrl.host}`);
if (!values.yes) {
  console.error('The token is single-use. Re-run with --yes to claim it.');
  process.exit(1);
}

const res = await fetch(claimUrl, { method: 'POST', headers: { 'content-length': '0' } });
if (!res.ok) {
  console.error(
    `Claim failed (${res.status}). If it was already claimed, make a new token in SimpleFIN.`,
  );
  process.exit(1);
}
const accessUrl = (await res.text()).trim();
if (!/^https:\/\/[^:@/]+:[^@/]+@/.test(accessUrl)) {
  console.error('SimpleFIN returned something that is not an access URL.');
  process.exit(1);
}

if (values.print) {
  console.log(accessUrl);
} else {
  try {
    execFileSync('npx', ['wrangler', 'secret', 'put', 'SIMPLEFIN_ACCESS_URL'], {
      input: accessUrl,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.error('Saved as the SIMPLEFIN_ACCESS_URL Worker secret.');
  } catch {
    console.error(
      'Claimed, but saving the secret failed. Run again with --print (the token is spent; ' +
        'the access URL is only shown with --print) — or make a new token.',
    );
    process.exit(1);
  }
}
