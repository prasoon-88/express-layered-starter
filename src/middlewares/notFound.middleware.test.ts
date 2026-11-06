import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { NotFoundError } from '#errors';
import { notFoundMiddleware } from './notFound.middleware.ts';

describe('notFoundMiddleware', () => {
  it('forwards a 404 ROUTE_NOT_FOUND naming the method and the URL', () => {
    const forwarded: unknown[] = [];

    notFoundMiddleware(
      { method: 'GET', originalUrl: '/nope?x=1' } as Request,
      {} as Response,
      (err?: unknown) => forwarded.push(err),
    );

    const [err] = forwarded;
    assert.ok(err instanceof NotFoundError);
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, 'ROUTE_NOT_FOUND');
    assert.equal(err.message, 'Route GET /nope?x=1 not found');
  });
});
