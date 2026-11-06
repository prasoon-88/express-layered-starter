import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError } from '#errors';
import { createUserRepository } from './user.repository.ts';

const newUser = {
  fullName: 'Ada',
  email: 'ada@example.com',
  passwordHash: 'h1',
  role: 'NORMAL',
} as const;

describe('userRepository', () => {
  it('creates a user at sessionVersion 0, findable by id and by email', async () => {
    const repo = createUserRepository();
    const user = await repo.create(newUser);

    assert.equal(user.sessionVersion, 0);
    assert.equal(await repo.findById(user.id), user);
    assert.equal(await repo.findByEmail(newUser.email), user);
  });

  it('refuses a second user with the same email', async () => {
    const repo = createUserRepository();
    await repo.create(newUser);
    await assert.rejects(repo.create(newUser), ConflictError);
  });

  describe('updatePassword', () => {
    it('sets the hash and raises sessionVersion when the expected hash matches', async () => {
      const repo = createUserRepository();
      const { id } = await repo.create(newUser);

      const updated = await repo.updatePassword(id, 'h1', 'h2');

      assert.equal(updated?.passwordHash, 'h2');
      assert.equal(updated?.sessionVersion, 1);
      assert.equal((await repo.findByEmail(newUser.email))?.passwordHash, 'h2');
    });

    it('changes nothing when the hash has changed since it was read', async () => {
      const repo = createUserRepository();
      const { id } = await repo.create(newUser);
      await repo.updatePassword(id, 'h1', 'h2');

      assert.equal(await repo.updatePassword(id, 'h1', 'h3'), undefined);
      assert.equal((await repo.findById(id))?.passwordHash, 'h2');
    });

    it('returns undefined for an unknown id', async () => {
      assert.equal(await createUserRepository().updatePassword('missing', 'h1', 'h2'), undefined);
    });

    it('leaves a row read earlier unchanged', async () => {
      const repo = createUserRepository();
      const before = await repo.create(newUser);
      await repo.updatePassword(before.id, 'h1', 'h2');

      assert.equal(before.passwordHash, 'h1');
    });
  });

  describe('endSessions', () => {
    it('raises sessionVersion on every call, so concurrent calls never lose one', async () => {
      const repo = createUserRepository();
      const { id } = await repo.create(newUser);

      await Promise.all([repo.endSessions(id), repo.endSessions(id)]);
      assert.equal((await repo.findById(id))?.sessionVersion, 2);
    });

    it('returns undefined for an unknown id', async () => {
      assert.equal(await createUserRepository().endSessions('missing'), undefined);
    });
  });
});
