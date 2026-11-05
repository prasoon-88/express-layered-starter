import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitHeaders } from './headers.ts';

describe('rateLimitHeaders', () => {
  it('writes the policy and the state in the IETF draft-7 format, reset in seconds', () => {
    assert.deepEqual(
      rateLimitHeaders({ limit: 100, remaining: 42, windowS: 60, resetMs: 59_001 }),
      {
        'RateLimit-Policy': '100;w=60',
        RateLimit: 'limit=100, remaining=42, reset=60',
      },
    );
  });

  it('rounds a partial second up, so a client never retries early', () => {
    assert.equal(
      rateLimitHeaders({ limit: 5, remaining: 0, windowS: 900, resetMs: 1 }).RateLimit,
      'limit=5, remaining=0, reset=1',
    );
  });
});
