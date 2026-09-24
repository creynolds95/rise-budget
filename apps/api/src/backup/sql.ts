/**
 * The pure half of backups (T46, ARCHITECTURE §8): splitting a dump back into statements,
 * naming/dating backup keys, and deciding which have aged out. No I/O here.
 */

/**
 * Splits a dump into statements on `;` outside quotes and comments. Enough for what
 * `dumpDatabase` writes and for `wrangler d1 export` output; not a general SQL parser
 * (a trigger body with inner `;` is kept whole only because it sits inside BEGIN…END).
 */
export function splitSql(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let depth = 0; // BEGIN … END nesting, for triggers
  let i = 0;
  const flush = () => {
    const s = buf.trim();
    if (s) out.push(s);
    buf = '';
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) {
          buf += quote;
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      buf += ch;
      i++;
      continue;
    }
    if (/[A-Za-z]/.test(ch) && !/[A-Za-z0-9_]/.test(text[i - 1] ?? ' ')) {
      const word = /^[A-Za-z_]+/.exec(text.slice(i, i + 12))?.[0].toUpperCase();
      if (word === 'BEGIN' && /\bTRIGGER\b/i.test(buf)) depth++;
      if (word === 'END' && depth > 0) depth--;
    }
    if (ch === ';' && depth === 0) {
      flush();
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** `backups/YYYY-MM-DD.sql.gz`, dated by the UTC day the backup ran. */
export function backupKey(now: Date): string {
  return `backups/${now.toISOString().slice(0, 10)}.sql.gz`;
}

const KEY = /^backups\/(\d{4}-\d{2}-\d{2})\.sql\.gz$/;

export function backupDate(key: string): string | null {
  return KEY.exec(key)?.[1] ?? null;
}

/**
 * Backups older than `keepDays` (ARCHITECTURE §8: 90). Only keys this module wrote are ever
 * candidates, so nothing else in the bucket can be deleted by mistake.
 */
export function expiredBackups(keys: string[], now: Date, keepDays = 90): string[] {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
  return keys.filter((k) => {
    const d = backupDate(k);
    return d !== null && d < cutoff;
  });
}

async function pipe(data: BufferSource, stream: CompressionStream | DecompressionStream) {
  const body = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export const gzip = (text: string) =>
  pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));

export const gunzip = async (data: BufferSource) =>
  new TextDecoder().decode(await pipe(data, new DecompressionStream('gzip')));
