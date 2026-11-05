import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { BadRequestError } from '#errors';
import zodConverter from './zod.converter.ts';
import jwtConverter from './jwt.converter.ts';
import { convertError } from './index.ts';

const failure = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  assert.ok(!result.success);
  return result.error;
};

describe('zodConverter', () => {
  it('turns a ZodError into a 400 with one entry per failing field', () => {
    const schema = z.object({ email: z.email(), age: z.number().min(18) });

    const err = zodConverter(failure(schema, { email: 'nope', age: 3 }));

    assert.ok(err instanceof BadRequestError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, 'Validation Failed');
    assert.deepEqual(
      (err.details as { path: string }[]).map((d) => d.path),
      ['email', 'age'],
    );
  });

  it('reports each unrecognized key separately, with the key in its path', () => {
    const err = zodConverter(
      failure(z.strictObject({ name: z.string() }), { name: 'a', admin: true, root: 1 }),
    );

    assert.deepEqual(err?.details, [
      { path: 'admin', message: 'Unrecognized field' },
      { path: 'root', message: 'Unrecognized field' },
    ]);
  });

  it('joins nested paths with dots', () => {
    const err = zodConverter(
      failure(z.object({ a: z.array(z.object({ b: z.string() })) }), { a: [{ b: 1 }] }),
    );

    assert.deepEqual(
      (err?.details as { path: string }[]).map((d) => d.path),
      ['a.0.b'],
    );
  });

  it('leaves anything that is not a ZodError alone', () => {
    assert.equal(zodConverter(new Error('x')), null);
    assert.equal(zodConverter('x'), null);
  });
});

describe('jwtConverter', () => {
  const named = (name: string) => Object.assign(new Error('jwt'), { name });

  it('maps an expired token to 401 TOKEN_EXPIRED', () => {
    const err = jwtConverter(named('TokenExpiredError'));
    assert.deepEqual([err?.statusCode, err?.code], [401, 'TOKEN_EXPIRED']);
  });

  it('maps a not-yet-valid or malformed token to 401 TOKEN_INVALID', () => {
    for (const name of ['NotBeforeError', 'JsonWebTokenError']) {
      const err = jwtConverter(named(name));
      assert.deepEqual([err?.statusCode, err?.code], [401, 'TOKEN_INVALID'], name);
    }
  });

  it('returns null for anything it does not recognise', () => {
    assert.equal(jwtConverter(new Error('x')), null);
    assert.equal(jwtConverter('x'), null);
  });
});

describe('convertError', () => {
  it('runs every converter and returns null for an error none of them knows', () => {
    assert.equal(convertError(new Error('plain')), null);
    assert.ok(convertError(failure(z.string(), 1)) instanceof BadRequestError);
    assert.equal(
      convertError(Object.assign(new Error('x'), { name: 'TokenExpiredError' }))?.code,
      'TOKEN_EXPIRED',
    );
  });
});
