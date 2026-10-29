import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_DB_ID,
  PLACEHOLDER_HOST,
  findDatabaseId,
  findDeployedHost,
  readCount,
  renderLocalConfig,
  secretNames,
} from '../scripts/setup-lib';

const DB = '12345678-9abc-def0-1234-56789abcdef0';
const TEMPLATE = `database_id = "${PLACEHOLDER_DB_ID}"\nRP_ID = "${PLACEHOLDER_HOST}"\nRP_ORIGIN = "https://${PLACEHOLDER_HOST}"\n`;

describe('setup helpers', () => {
  it('fills both placeholders and every host occurrence', () => {
    const out = renderLocalConfig(TEMPLATE, DB, 'rise.someone.workers.dev');
    expect(out).toContain(`database_id = "${DB}"`);
    expect(out).toContain('RP_ORIGIN = "https://rise.someone.workers.dev"');
    expect(out).not.toContain(PLACEHOLDER_HOST);
  });

  it('refuses bad ids, hosts with a scheme, and a template without placeholders', () => {
    expect(() => renderLocalConfig(TEMPLATE, 'nope', 'rise.a.workers.dev')).toThrow();
    expect(() => renderLocalConfig(TEMPLATE, DB, 'https://rise.a.workers.dev')).toThrow();
    expect(() => renderLocalConfig('database_id = "x"', DB, 'rise.a.workers.dev')).toThrow();
  });

  it('finds the rise database by exact name', () => {
    const list = JSON.stringify([
      { name: 'rise-old', uuid: '00000000-0000-0000-0000-000000000001' },
      { name: 'rise', uuid: DB },
    ]);
    expect(findDatabaseId(list, 'rise')).toBe(DB);
    expect(findDatabaseId('[]', 'rise')).toBeNull();
  });

  it('reads the workers.dev host from deploy output', () => {
    const out =
      'Uploaded rise (3.1 sec)\nDeployed rise triggers\n  https://rise.someone.workers.dev\n';
    expect(findDeployedHost(out, 'rise')).toBe('rise.someone.workers.dev');
    expect(findDeployedHost('Deployed with no routes', 'rise')).toBeNull();
  });

  it('reads a COUNT and secret names', () => {
    expect(readCount(JSON.stringify([{ results: [{ n: 2 }], success: true }]))).toBe(2);
    expect(() => readCount('[]')).toThrow();
    expect(secretNames(JSON.stringify([{ name: 'TOTP_KEY', type: 'secret_text' }, {}]))).toEqual([
      'TOTP_KEY',
    ]);
  });
});
