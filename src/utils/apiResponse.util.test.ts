import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { listen, revalidate } from '#testing/http';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { apiResponse } = await import('./apiResponse.util.ts');
const { requestContext } = await import('#contexts/requestContext');

describe('apiResponse ETag', () => {
  let server: Server;
  let baseUrl = '';

  before(async () => {
    const app = express();
    app.use((_req, _res, next) => requestContext.run({ requestId: randomUUID() }, next));
    app.get('/ok', (_req, res) => apiResponse.ok(res, { id: 1 }));
    app.get('/page', (_req, res) =>
      apiResponse.pagination(res, [{ id: 1 }], { total: 1, page: 1, pageSize: 10 }),
    );
    app.get('/secret', (_req, res) =>
      apiResponse.ok(res, { id: 1 }, { headers: { 'Cache-Control': 'no-store' } }),
    );
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server.close();
  });

  const get = (path: string) => fetch(`${baseUrl}${path}`);

  it('answers a matching If-None-Match with 304 and an empty body', async () => {
    const etag = (await get('/ok')).headers.get('ETag') ?? '';

    const revalidated = await revalidate(`${baseUrl}/ok`, etag);

    assert.equal(revalidated.status, 304);
    assert.equal(await revalidated.text(), '');
  });

  it('gives a page the same ETag on every request, meta included', async () => {
    const first = await get('/page');
    const second = await get('/page');

    assert.ok('meta' in ((await first.json()) as object));
    assert.equal(first.headers.get('ETag'), second.headers.get('ETag'));
  });

  it('sets no stable ETag when the headers it was given say no-store', async () => {
    const first = await get('/secret');
    const second = await get('/secret');

    assert.equal(first.headers.get('Cache-Control'), 'no-store');
    assert.notEqual(first.headers.get('ETag'), second.headers.get('ETag'));
  });
});
