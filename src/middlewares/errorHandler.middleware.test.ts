import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { errorHandlerMiddleware } = await import('./errorHandler.middleware.ts');
const { NotFoundError, InternalServerError } = await import('#errors');

class FakeResponse {
  headersSent = false;
  statusCode = 200;
  locals: Record<string, unknown> = {};
  body: unknown;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    return this;
  }
}

const handle = (err: unknown) => {
  const res = new FakeResponse();
  const req = { id: 'req-1', originalUrl: '/api/x', xhr: false } as unknown as Request;
  errorHandlerMiddleware(err, req, res as unknown as Response, (() => {}) as NextFunction);
  return res;
};

describe('errorHandlerMiddleware', () => {
  it('records the error code on res.locals so the access log can carry it', () => {
    const res = handle(new NotFoundError('nope'));

    assert.equal(res.statusCode, 404);
    assert.equal(res.locals.errorCode, 'NOT_FOUND');
  });

  it('records INTERNAL_ERROR for an unexpected throw', () => {
    const res = handle(new Error('boom'));

    assert.equal(res.statusCode, 500);
    assert.equal(res.locals.errorCode, 'INTERNAL_ERROR');
  });

  it('keeps the message of an unexpected error away from the client', () => {
    const res = handle(new Error('db password is hunter2'));

    assert.equal((res.body as { message: string }).message, new InternalServerError().message);
  });
});
