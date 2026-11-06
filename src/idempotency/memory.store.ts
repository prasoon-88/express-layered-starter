import type {
  AcquireResult,
  CompletedRecord,
  IdempotencyStore,
  InProgressRecord,
} from './types.ts';

type Entry = { record: InProgressRecord | CompletedRecord; expiresAt: number };

export const createMemoryStore = (now: () => number = Date.now): IdempotencyStore => {
  const records = new Map<string, Entry>();

  const current = (key: string) => {
    const entry = records.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      records.delete(key);
      return undefined;
    }
    return entry;
  };

  const acquire = (
    key: string,
    record: InProgressRecord,
    lockTtlMs: number,
  ): Promise<AcquireResult> => {
    const existing = current(key);
    if (existing) return Promise.resolve({ acquired: false, existing: existing.record });
    records.set(key, { record, expiresAt: now() + lockTtlMs });
    return Promise.resolve({ acquired: true });
  };

  const complete = (key: string, token: string, record: CompletedRecord, ttlMs: number) => {
    const existing = current(key);
    if (!existing || existing.record.state !== 'in_progress' || existing.record.token !== token)
      return Promise.resolve(false);
    records.set(key, { record, expiresAt: now() + ttlMs });
    return Promise.resolve(true);
  };

  const release = (key: string, token: string) => {
    const existing = current(key);
    if (existing?.record.state === 'in_progress' && existing.record.token === token)
      records.delete(key);
    return Promise.resolve();
  };

  return { acquire, complete, release };
};
