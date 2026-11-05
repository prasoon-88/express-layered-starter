import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

process.env.NODE_ENV ??= 'test';

const { default: requestIdMiddleware } = await import('./requestId.middleware.ts');
const { default: requestContext } = await import('#contexts/requestContext');

const run = (incoming: string | undefined, options?: Parameters<typeof requestIdMiddleware>[0]) => {
  const sent: Record<string, string> = {};
  const req = {
    get: (name: string) => (name.toLowerCase() === 'x-request-id' ? incoming : undefined),
  } as unknown as Request;
  const res = {
    set: (name: string, value: string) => {
      sent[name] = value;
    },
  } as unknown as Response;

  let inContext: string | undefined;
  requestIdMiddleware({ generator: () => 'generated-id', ...options })(req, res, () => {
    inContext = requestContext.getRequestId();
  });

  return { req, sent, inContext };
};

describe('requestIdMiddleware', () => {
  it('keeps a well-formed incoming id, echoes it, and exposes it to the request context', () => {
    const { req, sent, inContext } = run('abc-123_XYZ');

    assert.equal(req.id, 'abc-123_XYZ');
    assert.equal(sent['X-Request-Id'], 'abc-123_XYZ');
    assert.equal(inContext, 'abc-123_XYZ');
  });

  it('generates an id when none arrives', () => {
    assert.equal(run(undefined).req.id, 'generated-id');
  });

  it('replaces an id with unsafe characters, so it cannot reach logs or headers', () => {
    assert.equal(run('bad id\r\nSet-Cookie: x').req.id, 'generated-id');
  });

  it('replaces an id longer than 128 characters', () => {
    assert.equal(run('a'.repeat(128)).req.id, 'a'.repeat(128));
    assert.equal(run('a'.repeat(129)).req.id, 'generated-id');
  });

  it('ignores the incoming id when it is not trusted', () => {
    assert.equal(run('abc', { trustIncoming: false }).req.id, 'generated-id');
  });
});
