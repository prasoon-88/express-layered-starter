import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import {
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from '#errors';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';
import { createIdempotent } from './middleware.ts';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';
import { createMemoryStore } from './memory.store.ts';
import type { IdempotencyStore } from './types.ts';
import { UnknownPolicyError } from './errors.ts';

const log = pino({ level: 'silent' });

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  payload: Buffer | undefined;
  writableFinished = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  set(field: string | Record<string, string>, value?: string) {
    if (typeof field === 'string') this.headers[field] = value ?? '';
    else Object.assign(this.headers, field);
    return this;
  }

  getHeader(name: string) {
    const found = Object.entries(this.headers).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return found?.[1];
  }

  send(chunk?: unknown) {
    return this.end(chunk);
  }

  end(chunk?: unknown) {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) this.payload = Buffer.from(chunk);
    this.writableFinished = true;
    this.emit('finish');
    return this;
  }
}

const policies = () =>
  createPolicyRegistry(buildDefaultPolicies({ IDEMPOTENCY_TTL_S: 60, IDEMPOTENCY_LOCK_TTL_S: 60 }));

const build = (
  store: IdempotencyStore,
  overrides: { enabled?: boolean; onStoreError?: 'allow' | 'deny' } = {},
) =>
  createIdempotent({
    enabled: overrides.enabled ?? true,
    store,
    policies: policies(),
    prefix: 'test',
    maxBodyBytes: 1024,
    onStoreError: overrides.onStoreError ?? 'deny',
    log,
  });

const request = (key: string | undefined, body: unknown, method = 'POST') =>
  ({
    method,
    baseUrl: '/api/v1/user',
    path: '/register',
    body,
    ip: '203.0.113.8',
    get: (name: string) =>
      key !== undefined && name.toLowerCase() === HTTP_HEADERS.IDEMPOTENCY_KEY.toLowerCase()
        ? key
        : undefined,
  }) as unknown as Request;

const settle = () => new Promise((resolve) => setImmediate(resolve));

const hit = async (
  handler: ReturnType<ReturnType<typeof build>>,
  req: Request,
  respond?: (res: FakeResponse) => void,
) => {
  const res = new FakeResponse();
  let continued = false;
  const next: NextFunction = () => {
    continued = true;
    respond?.(res);
  };
  await handler(req, res as unknown as Response, next);
  await settle();
  return { res, continued };
};

describe('createIdempotent', () => {
  it('stores the first response and replays it', async () => {
    const handler = build(createMemoryStore())('default');
    const req = request('replay-key-1', { email: 'a@example.com' });

    const first = await hit(handler, req, (res) => {
      res.status(201).set('Content-Type', 'application/json').send('{"ok":true}');
    });
    const second = await hit(handler, req, () => {
      throw new Error('handler ran again');
    });

    assert.equal(first.continued, true);
    assert.equal(second.continued, false);
    assert.equal(second.res.statusCode, 201);
    assert.equal(second.res.headers['Idempotent-Replayed'], 'true');
    assert.equal(second.res.payload?.toString(), '{"ok":true}');
  });

  it('rejects the same key when the body differs', async () => {
    const handler = build(createMemoryStore())('default');
    await hit(handler, request('replay-key-2', { email: 'a@example.com' }), (res) => {
      res.status(201).send('{"ok":true}');
    });

    await assert.rejects(
      hit(handler, request('replay-key-2', { email: 'b@example.com' })),
      UnprocessableEntityError,
    );
  });

  it('tells a concurrent retry to come back later', async () => {
    const handler = build(createMemoryStore())('default');
    const req = request('replay-key-3', { email: 'a@example.com' });
    const first = hit(handler, req);
    await assert.rejects(hit(handler, req), ConflictError);
    const { res } = await first;
    res.status(201).send('{"ok":true}');
  });

  it('forgets a failed response so the retry runs the handler', async () => {
    const handler = build(createMemoryStore())('default');
    const req = request('replay-key-4', { email: 'a@example.com' });
    await hit(handler, req, (res) => {
      res.status(500).send('{"ok":false}');
    });
    const retried = await hit(handler, req, (res) => {
      res.status(201).send('{"ok":true}');
    });
    assert.equal(retried.continued, true);
    assert.equal(retried.res.statusCode, 201);
  });

  it('requires a key on the payments policy and ignores other methods', async () => {
    const handler = build(createMemoryStore())('payments');
    await assert.rejects(hit(handler, request(undefined, {})), BadRequestError);
    const fetched = await hit(handler, request(undefined, {}, 'GET'));
    assert.equal(fetched.continued, true);
  });

  it('rejects a malformed key', async () => {
    const handler = build(createMemoryStore())('default');
    await assert.rejects(
      hit(handler, request('short', { email: 'a@example.com' })),
      BadRequestError,
    );
  });

  it('fails at setup when the policy name is unknown', () => {
    assert.throws(() => build(createMemoryStore())('missing' as 'default'), UnknownPolicyError);
  });

  it('answers 503 when the store is down and the mode is deny', async () => {
    const store: IdempotencyStore = {
      acquire: () => Promise.reject(new Error('down')),
      complete: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    await assert.rejects(
      hit(build(store)('default'), request('replay-key-5', { email: 'a@example.com' })),
      ServiceUnavailableError,
    );
  });

  it('runs the handler when the store is down and the mode is allow', async () => {
    const store: IdempotencyStore = {
      acquire: () => Promise.reject(new Error('down')),
      complete: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const result = await hit(
      build(store, { onStoreError: 'allow' })('default'),
      request('replay-key-6', { email: 'a@example.com' }),
    );
    assert.equal(result.continued, true);
  });

  it('does nothing when idempotency is disabled', async () => {
    let acquired = false;
    const store: IdempotencyStore = {
      acquire: () => {
        acquired = true;
        return Promise.reject(new Error('should not be called'));
      },
      complete: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const result = await hit(
      build(store, { enabled: false })('default'),
      request(undefined, { email: 'a@example.com' }),
    );
    assert.equal(result.continued, true);
    assert.equal(acquired, false);
  });
});
