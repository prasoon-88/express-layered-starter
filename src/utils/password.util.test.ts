import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.util.ts';

describe('password hashing', () => {
  it('verifies the password it hashed and rejects any other', async () => {
    const hash = await hashPassword('correct horse battery staple');

    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('correct horse battery stapl', hash), false);
  });

  it('never stores the password and salts every hash', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ]);

    assert.notEqual(a, b);
    assert.equal(a.includes('same-password'), false);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    assert.equal(await verifyPassword('x', 'not-a-hash'), false);
    assert.equal(await verifyPassword('x', ':'), false);
  });
});
