import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

type Listenable = { listen: (port: number, host: string) => Server };

/**
 * Starts an Express app or an http.Server on a free loopback port. Rejects if it cannot listen,
 * rather than waiting forever for a `listening` that never comes. The caller closes `server`.
 */
export const listen = async (target: Listenable) => {
  const server = target.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

/** A JSON POST. An `undefined` body sends no body at all, still with the JSON content type. */
export const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

/**
 * A conditional GET. fetch adds `Cache-Control: no-cache` to any request carrying If-None-Match,
 * which makes the server ignore the validator, so this sends `max-age=0` as a browser does.
 */
export const revalidate = (url: string, etag: string) =>
  fetch(url, { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } });

/**
 * Polls `read` until it returns something other than `undefined`. A throw counts as not yet; if
 * time runs out, the last one is the timeout's cause.
 */
export const waitFor = async <T>(
  read: () => T | undefined | Promise<T | undefined>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}`, { cause: lastError });
    await sleep(100);
  }
};
