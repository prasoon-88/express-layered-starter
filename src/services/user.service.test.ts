import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { parseEnv } from '#constants/env/schema';
import { ConflictError, UnauthorizedError } from '#errors';
import { userProfileCacheSpec } from '#cache/user.cache';
import { initCache } from '#lib/cache/index';
import { createUserRepository, type UserRepository } from '#repository/user.repository';
import { verifyPassword } from '#utils/password.util';
import { createUserService, type UserService } from './user.service.ts';

// A real cache on the memory store, one per service, so tests never share entries.
const memoryCache = () =>
  initCache(parseEnv({ NODE_ENV: 'test' }), pino({ level: 'silent' })).cache;

const input = { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse-1' };

describe('userService.registerUser', () => {
  let userRepository: UserRepository;
  let userService: UserService;

  beforeEach(() => {
    userRepository = createUserRepository();
    userService = createUserService({ userRepository, cache: memoryCache() });
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
    const other = createUserService({
      userRepository: createUserRepository(),
      cache: memoryCache(),
    });

    await assert.doesNotReject(other.registerUser(input));
  });
});

describe('userService.getProfile', () => {
  it('returns the public fields and the role, never the hash', async () => {
    const userService = createUserService({
      userRepository: createUserRepository(),
      cache: memoryCache(),
    });
    const { id } = await userService.registerUser(input);

    assert.deepEqual(await userService.getProfile(id), {
      id,
      fullName: input.fullName,
      email: input.email,
      role: 'NORMAL',
    });
  });

  it('answers 401 for an account that no longer exists', async () => {
    const userService = createUserService({
      userRepository: createUserRepository(),
      cache: memoryCache(),
    });

    await assert.rejects(
      userService.getProfile('gone'),
      (err: unknown) => err instanceof UnauthorizedError && err.code === 'TOKEN_INVALID',
    );
  });

  /** A repository whose findById counts its calls. */
  const countingRepository = () => {
    const repository = createUserRepository();
    let reads = 0;
    const findById = (id: string) => {
      reads++;
      return repository.findById(id);
    };
    return { repository: { ...repository, findById }, reads: () => reads };
  };

  it('reads the store once, then serves the profile from the cache', async () => {
    const { repository, reads } = countingRepository();
    const userService = createUserService({ userRepository: repository, cache: memoryCache() });
    const { id } = await userService.registerUser(input);

    const first = await userService.getProfile(id);
    const second = await userService.getProfile(id);
    assert.deepEqual(second, first);
    assert.equal(reads(), 1);
  });

  it('reads the store again once another module invalidates the user’s tag', async () => {
    const { repository, reads } = countingRepository();
    const cache = memoryCache();
    const userService = createUserService({ userRepository: repository, cache });
    const { id } = await userService.registerUser(input);
    const other = await userService.registerUser({ ...input, email: 'bob@example.com' });

    await userService.getProfile(id);
    await userService.getProfile(other.id);
    // As a role change or an account deletion in another module would, after its write commits.
    await cache.invalidate(userProfileCacheSpec.tags.one(id));
    await userService.getProfile(id);
    await userService.getProfile(other.id);
    assert.equal(reads(), 3, 'only the invalidated user is read again');
  });

  it('never caches a missing account, so it is read every time', async () => {
    const { repository, reads } = countingRepository();
    const userService = createUserService({ userRepository: repository, cache: memoryCache() });

    await assert.rejects(userService.getProfile('gone'), UnauthorizedError);
    await assert.rejects(userService.getProfile('gone'), UnauthorizedError);
    assert.equal(reads(), 2);
  });

  it('reads the store every time while CACHE_ENABLED=false', async () => {
    const { repository, reads } = countingRepository();
    const cache = initCache(
      parseEnv({ NODE_ENV: 'test', CACHE_ENABLED: 'false' }),
      pino({ level: 'silent' }),
    ).cache;
    const userService = createUserService({ userRepository: repository, cache });
    const { id } = await userService.registerUser(input);

    await userService.getProfile(id);
    await userService.getProfile(id);
    assert.equal(reads(), 2);
  });
});
