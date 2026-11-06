import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '#errors';
import { createAuthorizeMiddleware } from './authorize.middleware.ts';

const run = (
  roles: Parameters<typeof createAuthorizeMiddleware>[0],
  user: Request['user'] | undefined,
) => {
  const forwarded: unknown[] = [];
  createAuthorizeMiddleware(roles)({ user } as Request, {} as Response, (err?: unknown) =>
    forwarded.push(err),
  );
  return forwarded;
};

const admin = { id: 'u1', email: 'a@example.com', role: 'ADMIN' } as const;
const normal = { id: 'u2', email: 'n@example.com', role: 'NORMAL' } as const;

describe('createAuthorizeMiddleware', () => {
  it('lets a caller with a listed role through', () => {
    assert.deepEqual(run(['ADMIN'], admin), [undefined]);
  });

  it('forwards a 403 for a signed-in caller without a listed role', () => {
    const [err] = run(['ADMIN'], normal);

    assert.ok(err instanceof ForbiddenError);
    assert.equal(err.statusCode, 403);
  });

  it('forwards a 401 when no caller was authenticated first', () => {
    const [err] = run(['ADMIN'], undefined);

    assert.ok(err instanceof UnauthorizedError);
    assert.equal(err.statusCode, 401);
  });

  it('refuses an empty role list when the route is built, since it could never let anyone in', () => {
    assert.throws(() => createAuthorizeMiddleware([]), /at least one role/);
  });
});
