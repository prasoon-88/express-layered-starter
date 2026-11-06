import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { concatenateStrings } from '#utils/concateStrings';

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value))
    return concatenateStrings(['[', concatenateStrings(value.map(canonical), ','), ']']);

  const entries = Object.keys(value)
    .sort()
    .map((key) =>
      concatenateStrings(
        [JSON.stringify(key), canonical((value as Record<string, unknown>)[key])],
        ':',
      ),
    );
  return concatenateStrings(['{', concatenateStrings(entries, ','), '}']);
};

const of = (req: Request) =>
  createHash('sha256')
    .update(
      concatenateStrings(
        [req.method, concatenateStrings([req.baseUrl, req.path]), canonical(req.body)],
        '\0',
      ),
    )
    .digest('base64url');

const key = (raw: string) => createHash('sha256').update(raw).digest('base64url');

export const fingerprint = { of, key };
