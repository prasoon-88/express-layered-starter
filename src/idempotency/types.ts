export type StoredResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type InProgressRecord = {
  state: 'in_progress';
  fingerprint: string;
  token: string;
  startedAt: number;
};

export type CompletedRecord = {
  state: 'completed';
  fingerprint: string;
  response?: StoredResponse;
  completedAt: number;
};

export type IdempotencyRecord = InProgressRecord | CompletedRecord;

export type AcquireResult = { acquired: true } | { acquired: false; existing: IdempotencyRecord };

export type IdempotencyStore = {
  acquire: (key: string, record: InProgressRecord, lockTtlMs: number) => Promise<AcquireResult>;
  complete: (
    key: string,
    token: string,
    record: CompletedRecord,
    ttlMs: number,
  ) => Promise<boolean>;
  release: (key: string, token: string) => Promise<void>;
  ping?: () => Promise<unknown>;
};

export type Policy = {
  ttlS: number;
  lockTtlS: number;
  required: boolean;
  methods: readonly string[];
};
