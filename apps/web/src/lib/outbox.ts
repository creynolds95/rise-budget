import { get as idbGet, set as idbSet, update as idbUpdate } from 'idb-keyval';

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
  /** An atomic read-modify-write, when the backing store has one (idb-keyval `update`). */
  update?(fn: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<void>;
}

type Locks = { request<T>(name: string, fn: () => Promise<T>): Promise<T> };

/**
 * Runs `fn` holding a Web Lock, so two tabs never interleave their read-modify-writes or
 * replay passes. Where the Web Locks API is missing it just runs — the in-tab queue in
 * `Outbox` still keeps this tab's own changes in order.
 */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as { locks?: Locks } | undefined)?.locks;
  return locks ? locks.request(name, fn) : fn();
}

/** 'ok' applied (or already applied); 'offline' try again later; 'rejected' never will apply. */
export type SendResult = 'ok' | 'offline' | { rejected: string };

/**
 * Only changes that are safe to apply late, without the person seeing the answer first.
 * Forgiving a deficit, creating a rule or moving
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

  /** This tab's changes to the stored list, one at a time. */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: OutboxStore,
    private readonly lockName = 'rise-outbox',
  ) {}

  /** Read-modify-write of the stored list that nothing else can interleave with. */
  private mutate(fn: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<void> {
    const run = () =>
      withLock(`${this.lockName}:write`, async () => {
        if (this.store.update) return this.store.update(fn);
        await this.store.save(fn(await this.store.load()));
      });
    const next = this.writes.then(run, run);
    this.writes = next.catch(() => undefined);
    return next;
  }

  add(entry: OutboxEntry): Promise<void> {
    return this.mutate((all) => (all.some((e) => e.key === entry.key) ? all : [...all, entry]));
  }

  /**
   * A change to the same thing reached the server directly, after these were queued. A
   * queued PATCH must not land later and undo it, so the fields the newer change set are
   * struck from older queued PATCHes to the same path; one left with nothing is dropped.
   */
  supersede(method: string, path: string, body: unknown): Promise<void> {
    if (method !== 'PATCH' || !isPlainObject(body)) return Promise.resolve();
    const changed = Object.keys(body);
    return this.mutate((all) =>
      all.flatMap((e) => {
        if (e.method !== 'PATCH' || e.path !== path || !isPlainObject(e.body)) return [e];
        const rest = Object.fromEntries(
          Object.entries(e.body).filter(([k]) => !changed.includes(k)),
        );
        return Object.keys(rest).length ? [{ ...e, body: rest }] : [];
      }),
    );
  }

  pending(): Promise<OutboxEntry[]> {
    return this.store.load();
  }

  /**
   * Send everything, oldest first. Stops at the first 'offline' so order is kept; a
   * rejected entry is dropped and reported. Concurrent calls share one pass.
   */
  replay(send: (e: OutboxEntry) => Promise<SendResult>) {
    this.replaying ??= withLock(`${this.lockName}:replay`, async () => {
      let sent = 0;
      const rejected: { entry: OutboxEntry; reason: string }[] = [];
      for (;;) {
        await this.writes;
        const [next] = await this.store.load();
        if (!next) break;
        const r = await send(next);
        if (r === 'offline') break;
        if (r === 'ok') sent++;
        else rejected.push({ entry: next, reason: r.rejected });
        // Only this entry goes: anything added while it was sending stays queued.
        await this.mutate((all) => all.filter((e) => e.key !== next.key));
      }
      return { sent, rejected };
    }).finally(() => {
      this.replaying = null;
    });
    return this.replaying;
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The device store: one IndexedDB key, changed only through idb-keyval's atomic `update`. */
export function idbStore(key: string): OutboxStore {
  return {
    load: async () => (await idbGet<OutboxEntry[]>(key)) ?? [],
    save: (entries) => idbSet(key, entries),
    update: (fn) => idbUpdate<OutboxEntry[]>(key, (old) => fn(old ?? [])),
  };
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
