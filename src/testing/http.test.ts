import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import { listen, postJson, waitFor } from './http.ts';

describe('listen and postJson', () => {
  let server: Server;
  let baseUrl = '';

  before(async () => {
    const app = express();
    // The raw text, not parsed JSON: an empty body would parse to `{}` too.
    app.post('/echo', express.text({ type: '*/*' }), (req, res) => {
      res.json({
        type: req.get('content-type'),
        length: req.get('content-length'),
        raw: String(req.body),
        auth: req.get('x-auth'),
      });
    });
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server.close();
  });

  it('serves on a loopback port', () => {
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('sends the body as JSON, with the extra headers', async () => {
    const response = await postJson(`${baseUrl}/echo`, { a: 1 }, { 'X-Auth': 'yes' });

    assert.deepEqual(await response.json(), {
      type: 'application/json',
      length: '7',
      raw: '{"a":1}',
      auth: 'yes',
    });
  });

  it('sends no body at all for an undefined body', async () => {
    const response = await postJson(`${baseUrl}/echo`, undefined);
    const echoed = (await response.json()) as { type: string; length: string };

    assert.equal(echoed.type, 'application/json');
    assert.equal(echoed.length, '0');
  });

  it('rejects instead of hanging when the server cannot listen', async () => {
    await assert.rejects(listen(server), { code: 'ERR_SERVER_ALREADY_LISTEN' });
  });
});

describe('waitFor', () => {
  it('returns the first value that is not undefined, falsy ones included', async () => {
    let calls = 0;
    const value = await waitFor(() => (++calls < 3 ? undefined : 0), 'zero');

    assert.equal(value, 0);
    assert.equal(calls, 3);
  });

  it('treats a throw as not yet', async () => {
    let calls = 0;
    const value = await waitFor(() => {
      if (++calls < 2) throw new Error('not up');
      return Promise.resolve('up');
    }, 'up');

    assert.equal(value, 'up');
  });

  it('times out naming what it waited for, with the last error as the cause', async () => {
    const last = new Error('still down');

    await assert.rejects(
      waitFor(
        () => {
          throw last;
        },
        'the store',
        150,
      ),
      (err: Error) => err.message === 'timed out waiting for the store' && err.cause === last,
    );
  });
});
