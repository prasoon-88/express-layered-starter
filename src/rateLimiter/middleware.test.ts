import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { TooManyRequestsError } from '#errors';
import { createRateLimitEngine } from './engine.ts';
import { createLimit } from './middleware.ts';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';

const log = pino({ level: 'silent' });

// A real engine over the real in-memory limiter, so a refund actually changes what the next request sees.
const buildLimit = () =>
  createLimit({
    enabled: true,
    skipPaths: [],
    ipv6Subnet: 56,
    engine: createRateLimitEngine({
      policies: createPolicyRegistry(
        buildDefaultPolicies({
          RATE_LIMIT_MAX: 100,
          RATE_LIMIT_WINDOW_S: 60,
          RATE_LIMIT_AUTH_MAX: 10,
          RATE_LIMIT_AUTH_WINDOW_S: 900,
          RATE_LIMIT_AUTH_BLOCK_S: 900,
        }),
      ),
      prefix: 'test',
      onStoreError: 'local',
      log,
    }),
  });

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};

  set(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
}

const hit = async (
  handler: ReturnType<ReturnType<typeof buildLimit>>,
  ip: string,
  status: number,
) => {
  const res = new FakeResponse();
  res.statusCode = status;
  const calls: unknown[][] = [];
  const next: NextFunction = (...args: unknown[]) => {
    calls.push(args);
  };

  await handler(
    { method: 'GET', path: '/x', ip } as unknown as Request,
    res as unknown as Response,
    next,
  );

  return { res, calls, finish: () => res.emit('finish') };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('createLimit refundOnSuccess', () => {
  it('gives the point back after a successful response', async () => {
    const handler = buildLimit()({
      policy: { points: 1, durationS: 60 },
      refundOnSuccess: true,
    });

    const first = await hit(handler, '203.0.113.1', 200);
    first.finish();
    await settle();

    const second = await hit(handler, '203.0.113.1', 200);
    assert.deepEqual(
      second.calls,
      [[]],
      'second request is allowed because the first was refunded',
    );
  });

  it('keeps the point after a failed response', async () => {
    const handler = buildLimit()({
      policy: { points: 1, durationS: 60 },
      refundOnSuccess: true,
    });

    const first = await hit(handler, '203.0.113.2', 500);
    first.finish();
    await settle();

    await assert.rejects(hit(handler, '203.0.113.2', 200), TooManyRequestsError);
  });

  it('does not refund when refundOnSuccess is off', async () => {
    const handler = buildLimit()({ policy: { points: 1, durationS: 60 } });

    const first = await hit(handler, '203.0.113.3', 200);
    first.finish();
    await settle();

    await assert.rejects(hit(handler, '203.0.113.3', 200), TooManyRequestsError);
  });
});
