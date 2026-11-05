import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';

process.env.NODE_ENV ??= 'test';

const { default: httpLoggerMiddleware } = await import('./httpLogger.middleware.ts');

type Entry = { level: string; data: Record<string, unknown>; message: string };

const recordingLogger = () => {
  const entries: Entry[] = [];
  const at = (level: string) => (data: Record<string, unknown>, message: string) => {
    entries.push({ level, data, message });
  };
  const logger = { info: at('info'), warn: at('warn'), error: at('error') } as unknown as Logger;
  return { logger, entries };
};

const run = (
  url: string,
  {
    status = 200,
    locals = {},
    writableFinished = true,
    ...options
  }: {
    status?: number;
    locals?: Record<string, unknown>;
    writableFinished?: boolean;
    ignorePaths?: readonly string[];
    slowRequestMs?: number;
  } = {},
) => {
  const { logger, entries } = recordingLogger();
  const res = Object.assign(new EventEmitter(), {
    statusCode: status,
    writableFinished,
    locals,
    get: () => undefined,
  });
  const req = { originalUrl: url, method: 'GET', id: 'req-1', ip: '203.0.113.7', get: () => 'ua' };

  let nexted = false;
  httpLoggerMiddleware({ logger, ignorePaths: [], slowRequestMs: 1_000, ...options })(
    req as unknown as Request,
    res as unknown as Response,
    () => {
      nexted = true;
    },
  );

  return { res, entries, nexted: () => nexted };
};

describe('httpLoggerMiddleware', () => {
  it('logs one line per request, with the request id and no query string', () => {
    const { res, entries } = run('/api/things?token=secret&page=2');

    res.emit('finish');

    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry?.level, 'info');
    assert.equal(entry.data.path, '/api/things', 'the query string can carry secrets');
    assert.equal(entry.data.requestId, 'req-1');
    assert.equal(JSON.stringify(entry).includes('secret'), false);
  });

  it('picks the level from the status: 2xx info, 4xx warn, 5xx error', () => {
    const levels = [200, 302, 404, 429, 500, 503].map((status) => {
      const { res, entries } = run('/x', { status });
      res.emit('finish');
      return entries[0]?.level;
    });

    assert.deepEqual(levels, ['info', 'info', 'warn', 'warn', 'error', 'error']);
  });

  it('flags a slow request and logs it as a warning', () => {
    const { res, entries } = run('/x', { slowRequestMs: 0 });

    res.emit('finish');

    assert.equal(entries[0]?.level, 'warn');
    assert.equal(entries[0].data.slow, true);
  });

  it('flags a connection closed before the response finished as aborted', () => {
    const { res, entries } = run('/x', { writableFinished: false });

    res.emit('close');

    assert.equal(entries[0]?.level, 'warn');
    assert.equal(entries[0].data.aborted, true);
  });

  it('logs once even though finish and close both fire', () => {
    const { res, entries } = run('/x');

    res.emit('finish');
    res.emit('close');

    assert.equal(entries.length, 1);
  });

  it('includes the error code the error handler set', () => {
    const { res, entries } = run('/x', { status: 404, locals: { errorCode: 'ROUTE_NOT_FOUND' } });

    res.emit('finish');

    assert.equal(entries[0]?.data.errorCode, 'ROUTE_NOT_FOUND');
  });

  it('skips ignored paths and their children, but still continues the chain', () => {
    for (const url of ['/health', '/health/live', '/health?probe=1']) {
      const { res, entries, nexted } = run(url, { ignorePaths: ['/health'] });
      res.emit('finish');
      assert.equal(entries.length, 0, url);
      assert.equal(nexted(), true, url);
    }
  });

  it('does not ignore a path that only shares a prefix', () => {
    const { res, entries } = run('/healthy', { ignorePaths: ['/health'] });

    res.emit('finish');

    assert.equal(entries.length, 1);
  });
});
