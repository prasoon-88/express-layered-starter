import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStoreReadinessCheck } from './readiness.ts';

const redis = { ping: () => Promise.resolve('PONG' as const) };

describe('createStoreReadinessCheck', () => {
  it('is critical only when a store failure denies requests', () => {
    assert.equal(createStoreReadinessCheck({ redis, onStoreError: 'deny' }).critical, true);
    // `local` and `allow` keep serving through a Redis outage, so it is reported, not fatal.
    assert.equal(createStoreReadinessCheck({ redis, onStoreError: 'local' }).critical, false);
    assert.equal(createStoreReadinessCheck({ redis, onStoreError: 'allow' }).critical, false);
  });

  it('is named after what it checks', () => {
    assert.equal(
      createStoreReadinessCheck({ redis, onStoreError: 'local' }).name,
      'rate-limit-store',
    );
  });

  it('passes when Redis answers a ping', async () => {
    await assert.doesNotReject(createStoreReadinessCheck({ redis, onStoreError: 'local' }).run());
  });

  it('fails when the Redis client cannot answer', async () => {
    const dead = { ping: () => Promise.reject(new Error('The client is closed')) };

    await assert.rejects(createStoreReadinessCheck({ redis: dead, onStoreError: 'local' }).run());
  });
});
