import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { createHealthController } = await import('./health.controller.ts');
const { ServiceUnavailableError } = await import('#errors');
const { lifecycleState } = await import('#lib/lifecycle/state');

class FakeResponse {
  req = {};
  headersSent = false;
  statusCode = 0;
  body: unknown;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    this.headersSent = true;
    return this;
  }
}

const call = async (handler: ReturnType<typeof createHealthController>['ready']) => {
  const res = new FakeResponse();
  await handler({} as Request, res as unknown as Response, (() => {}) as NextFunction);
  return res;
};

const up = (name: string, critical = true) => ({ name, critical, run: () => Promise.resolve() });
const down = (name: string, critical = true) => ({
  name,
  critical,
  run: () => Promise.reject(new Error('connection refused')),
});

describe('health controller', () => {
  describe('ready', () => {
    it('is ok with nothing to check', async () => {
      const res = await call(createHealthController().ready);

      assert.equal(res.statusCode, 200);
      assert.deepEqual((res.body as { data: unknown }).data, { status: 'ok', checks: [] });
    });

    it('lists every dependency when all are up', async () => {
      const res = await call(createHealthController({ checks: [up('db'), up('cache')] }).ready);

      assert.equal(res.statusCode, 200);
      assert.deepEqual((res.body as { data: unknown }).data, {
        status: 'ok',
        checks: [
          { name: 'db', status: 'up' },
          { name: 'cache', status: 'up' },
        ],
      });
    });

    it('stays ready but reports degraded when only a non-critical dependency is down', async () => {
      const res = await call(
        createHealthController({ checks: [up('db'), down('cache', false)] }).ready,
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual((res.body as { data: unknown }).data, {
        status: 'degraded',
        checks: [
          { name: 'db', status: 'up' },
          { name: 'cache', status: 'down' },
        ],
      });
    });

    it('answers 503 when a critical dependency is down, naming it without the reason', async () => {
      const ready = createHealthController({ checks: [down('db'), up('cache')] }).ready;

      await assert.rejects(call(ready), (err: unknown) => {
        assert.ok(err instanceof ServiceUnavailableError);
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, 'SERVICE_UNAVAILABLE');
        assert.equal(err.message, 'dependency_unavailable');
        assert.deepEqual(err.details, [
          { name: 'db', status: 'down' },
          { name: 'cache', status: 'up' },
        ]);
        return true;
      });
    });
  });

  describe('live', () => {
    it('stays 200 even when a critical dependency is down', async () => {
      const res = await call(createHealthController({ checks: [down('db')] }).live);

      assert.equal(res.statusCode, 200);
    });
  });

  // Last on purpose: the shutdown flag is process-wide and cannot be reset.
  describe('while shutting down', () => {
    it('answers 503 on ready and 200 on live', async () => {
      const controller = createHealthController({ checks: [up('db')] });
      lifecycleState.markShutdown();

      await assert.rejects(call(controller.ready), (err: unknown) => {
        assert.ok(err instanceof ServiceUnavailableError);
        assert.equal(err.message, 'shutting_down');
        return true;
      });
      assert.equal((await call(controller.live)).statusCode, 200);
    });
  });
});
