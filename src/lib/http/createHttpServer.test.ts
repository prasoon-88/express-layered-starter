import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { parseEnv } from '#constants/env/schema';
import { createHttpServer } from './createHttpServer.ts';

describe('createHttpServer', () => {
  it('applies every configured timeout to the server', () => {
    const env = parseEnv({ NODE_ENV: 'test' });
    const server = createHttpServer({ app: express(), env });

    assert.equal(server.keepAliveTimeout, env.HTTP_KEEP_ALIVE_TIMEOUT_MS);
    assert.equal(server.headersTimeout, env.HTTP_HEADERS_TIMEOUT_MS);
    assert.equal(server.requestTimeout, env.HTTP_REQUEST_TIMEOUT_MS);
  });

  it('pins the keep-alive buffer that the env rules assume', () => {
    const server = createHttpServer({ app: express(), env: parseEnv({ NODE_ENV: 'test' }) });

    assert.equal(server.keepAliveTimeoutBuffer, 1000);
  });
});
