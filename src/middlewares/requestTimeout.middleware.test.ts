import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { createRequestTimeoutMiddleware } = await import('./requestTimeout.middleware.ts');
const { RequestTimeoutError } = await import('#errors/requestTimeout.error');

const nodeSignal = new AbortController().signal;

class FakeRequest {
  id = '1';
  method = 'GET';
  originalUrl = '/slow';
  deadline?: AbortSignal;
  get signal() {
    return nodeSignal;
  }
}

class FakeResponse extends EventEmitter {
  writableEnded = false;
  writableFinished = false;
  destroyed = false;
  headersSent = false;
  headers: Record<string, string> = {};

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  destroy() {
    this.destroyed = true;
  }
}

const callsOf = () => {
  const calls: unknown[][] = [];
  const next = (...args: unknown[]) => {
    calls.push(args);
  };
  return { calls, next: next as NextFunction };
};

const run = (ms: number, req: FakeRequest, res: FakeResponse, next: NextFunction, tickMs = 0) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    createRequestTimeoutMiddleware(ms)(req as unknown as Request, res as unknown as Response, next);
    if (tickMs > 0) mock.timers.tick(tickMs);
  } finally {
    mock.timers.reset();
  }
};

describe('createRequestTimeoutMiddleware', () => {
  it('puts the budget on req.deadline and leaves Node req.signal alone', () => {
    const req = new FakeRequest();
    const { calls, next } = callsOf();

    run(30_000, req, new FakeResponse(), next);

    assert.equal(req.signal, nodeSignal);
    assert.ok(req.deadline);
    assert.equal(req.deadline.aborted, false);
    assert.notEqual(req.deadline, nodeSignal);
    assert.deepEqual(calls, [[]]);
  });

  it('calls next once and does not abort when the timeout is disabled', () => {
    const req = new FakeRequest();
    const { calls, next } = callsOf();

    run(0, req, new FakeResponse(), next, 1_000);

    assert.deepEqual(calls, [[]]);
    assert.equal(req.deadline?.aborted, false);
  });

  it('forwards RequestTimeoutError through next when the budget is exceeded', () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    const { calls, next } = callsOf();

    run(25, req, res, next, 25);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], []);
    const err = calls[1]?.[0];
    assert.ok(err instanceof RequestTimeoutError);
    assert.equal(err.statusCode, 408);
    assert.equal(req.deadline?.aborted, true);
    assert.equal(res.headers.Connection, 'close');
    assert.equal(res.destroyed, false);
  });

  it('drops the socket when headers were already sent', () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    res.headersSent = true;
    const { calls, next } = callsOf();

    run(25, req, res, next, 25);

    assert.deepEqual(calls, [[]]);
    assert.equal(res.destroyed, true);
    assert.equal(req.deadline?.aborted, true);
  });

  it('does nothing when the response already finished', () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    res.writableEnded = true;
    const { calls, next } = callsOf();

    run(25, req, res, next, 25);

    assert.deepEqual(calls, [[]]);
    assert.equal(res.destroyed, false);
    assert.equal(req.deadline?.aborted, false);
  });
});
