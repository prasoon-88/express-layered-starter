import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, UnauthorizedError } from '#errors';
import { createUserRepository, type UserRepository } from '#repository/user.repository';
import { verifyPassword } from '#utils/password.util';
import { createUserService, type UserService } from './user.service.ts';

const input = { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse-1' };

describe('userService.registerUser', () => {
  let userRepository: UserRepository;
  let userService: UserService;

  beforeEach(() => {
    userRepository = createUserRepository();
    userService = createUserService({ userRepository });
  });

  it('stores a hash, never the password, and returns the public fields', async () => {
    const user = await userService.registerUser(input);

    assert.deepEqual(Object.keys(user).sort(), ['email', 'fullName', 'id']);

    const stored = await userRepository.findByEmail(input.email);
    assert.ok(stored);
    assert.notEqual(stored.passwordHash, input.password);
    assert.equal(await verifyPassword(input.password, stored.passwordHash), true);
  });

  it('gives every new account the NORMAL role', async () => {
    const { id } = await userService.registerUser(input);

    assert.equal((await userRepository.findById(id))?.role, 'NORMAL');
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

  it('keeps each repository separate, so two apps never share users', async () => {
    await userService.registerUser(input);
    const other = createUserService({ userRepository: createUserRepository() });

    await assert.doesNotReject(other.registerUser(input));
  });
});

describe('userService.getProfile', () => {
  it('returns the public fields and the role, never the hash', async () => {
    const userService = createUserService({ userRepository: createUserRepository() });
    const { id } = await userService.registerUser(input);

    assert.deepEqual(await userService.getProfile(id), {
      id,
      fullName: input.fullName,
      email: input.email,
      role: 'NORMAL',
    });
  });

  it('answers 401 for an account that no longer exists', async () => {
    const userService = createUserService({ userRepository: createUserRepository() });

    await assert.rejects(
      userService.getProfile('gone'),
      (err: unknown) => err instanceof UnauthorizedError && err.code === 'TOKEN_INVALID',
    );
  });
});
