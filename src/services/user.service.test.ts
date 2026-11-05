import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError } from '#errors';
import userRepository from '#repository/user.repository';
import { verifyPassword } from '#utils/password.util';
import userService from './user.service.ts';

const input = { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse-1' };

describe('userService.registerUser', () => {
  beforeEach(() => userRepository.clear());

  it('stores a hash, never the password, and returns the public fields', async () => {
    const user = await userService.registerUser(input);

    assert.deepEqual(Object.keys(user).sort(), ['email', 'fullName', 'id']);

    const stored = await userRepository.findByEmail(input.email);
    assert.ok(stored);
    assert.notEqual(stored.passwordHash, input.password);
    assert.equal(await verifyPassword(input.password, stored.passwordHash), true);
  });

  it('refuses a second registration of the same email with EMAIL_TAKEN', async () => {
    await userService.registerUser(input);

    await assert.rejects(
      userService.registerUser(input),
      (err: unknown) => err instanceof ConflictError && err.code === 'EMAIL_TAKEN',
    );
  });

  it('lets exactly one of two simultaneous registrations win', async () => {
    const results = await Promise.allSettled([
      userService.registerUser(input),
      userService.registerUser(input),
    ]);

    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  });
});
