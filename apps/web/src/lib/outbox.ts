/**
 * The offline mutation queue (SPEC §10, ARCHITECTURE §7). A change made offline is kept,
 * with the idempotency key it was first sent with, and replayed in order on reconnect. The
 * server rejects a key it has already applied by replaying its answer, so an entry sent
 * twice — say the app closed between send and removal — still lands once.
 */
export interface OutboxEntry {
  key: string;
  method: string;
  path: string;
  body: unknown;
  /** What the person did, in their words, for the banner. */
  label: string;
  queuedAt: string;
}

export interface OutboxStore {
  load(): Promise<OutboxEntry[]>;
  save(entries: OutboxEntry[]): Promise<void>;
}

/** 'ok' applied (or already applied); 'offline' try again later; 'rejected' never will apply. */
export type SendResult = 'ok' | 'offline' | { rejected: string };

/**
 * Only changes that are safe to apply late, without the person seeing the answer first.
 * Closing a month, recalculating carry, forgiving a deficit, creating a rule or moving
 * planned money can each need a decision from the server's reply — those need a connection
 * (CLAUDE.md: nothing about money changes silently).
 */
const QUEUEABLE: [method: string, path: RegExp][] = [
  ['PATCH', /^\/transactions\/[^/]+$/],
  ['POST', /^\/transactions\/[^/]+\/splits$/],
  ['POST', /^\/transactions\/[^/]+\/mark-transfer$/],
  ['POST', /^\/transactions\/[^/]+\/transfer-link$/],
  ['DELETE', /^\/transactions\/[^/]+\/transfer-link$/],
  ['POST', /^\/transactions\/bulk-accept$/],
  ['PATCH', /^\/merchants\/[^/]+$/],
  ['POST', /^\/accounts\/[^/]+\/snapshots$/],
];

export const isQueueable = (method: string, path: string) =>
  QUEUEABLE.some(([m, re]) => m === method && re.test(path));

export class Outbox {
  private replaying: Promise<{
    sent: number;
    rejected: { entry: OutboxEntry; reason: string }[];
  }> | null = null;

  constructor(private readonly store: OutboxStore) {}

  async add(entry: OutboxEntry): Promise<void> {
    const all = await this.store.load();
    if (all.some((e) => e.key === entry.key)) return;
    await this.store.save([...all, entry]);
  }

  pending(): Promise<OutboxEntry[]> {
    return this.store.load();
  }

  /**
   * Send everything, oldest first. Stops at the first 'offline' so order is kept; a
   * rejected entry is dropped and reported. Concurrent calls share one pass.
   */
  replay(send: (e: OutboxEntry) => Promise<SendResult>) {
    this.replaying ??= (async () => {
      let sent = 0;
      const rejected: { entry: OutboxEntry; reason: string }[] = [];
      try {
        for (;;) {
          const [next] = await this.store.load();
          if (!next) break;
          const r = await send(next);
          if (r === 'offline') break;
          if (r === 'ok') sent++;
          else rejected.push({ entry: next, reason: r.rejected });
          const rest = await this.store.load();
          await this.store.save(rest.filter((e) => e.key !== next.key));
        }
      } finally {
        this.replaying = null;
      }
      return { sent, rejected };
    })();
    return this.replaying;
  }
}

export function memoryStore(initial: OutboxEntry[] = []): OutboxStore {
  let entries = [...initial];
  return {
    load: () => Promise.resolve([...entries]),
    save: (e) => {
      entries = [...e];
      return Promise.resolve();
    },
  };
}
