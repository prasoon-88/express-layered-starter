import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createWorkerHealthServer } from './health.ts';

describe('createWorkerHealthServer', () => {
  let ready = false;
  const server = createWorkerHealthServer(() => ready);
  let base = '';

  before(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  const get = async (path: string, method = 'GET') => {
    const res = await fetch(base + path, { method });
    return {
      status: res.status,
      body: await res.json(),
      cache: res.headers.get('cache-control'),
    };
  };

  it('is live while the process runs, and ready only while the workers are', async () => {
    assert.deepEqual(await get('/health/live'), {
      status: 200,
      body: { status: 'ok' },
      cache: 'no-store',
    });
    assert.equal((await get('/health/ready')).status, 503);
    ready = true;
    assert.equal((await get('/health/ready')).status, 200);
  });

  it('answers 404 for another path and 405 for another method', async () => {
    assert.equal((await get('/')).status, 404);
    assert.equal((await get('/health/live', 'POST')).status, 405);
  });
});
