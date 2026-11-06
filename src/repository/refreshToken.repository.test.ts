import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshTokenRepository } from './refreshToken.repository.ts';

const token = (id: string, familyId = 'f1', expiresAt = 10_000) => ({
  id,
  userId: 'u1',
  familyId,
  hash: `hash-${id}`,
  expiresAt,
});

describe('refreshTokenRepository', () => {
  it('stores a token as unused and unrevoked', async () => {
    const repo = createRefreshTokenRepository();
    await repo.create(token('t1'), 0);

    assert.deepEqual(await repo.findById('t1'), { ...token('t1'), usedAt: null, revokedAt: null });
    assert.equal(await repo.findById('missing'), undefined);
  });

  it('returns a copy, so editing it does not change the stored row', async () => {
    const repo = createRefreshTokenRepository();
    await repo.create(token('t1'), 0);

    const found = await repo.findById('t1');
    found!.usedAt = 1;
    assert.equal((await repo.findById('t1'))?.usedAt, null);
  });

  it('lets exactly one of two simultaneous markUsed calls win', async () => {
    const repo = createRefreshTokenRepository();
    await repo.create(token('t1'), 0);

    const results = await Promise.all([repo.markUsed('t1', 5), repo.markUsed('t1', 6)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await repo.findById('t1'))?.usedAt, 5);
  });

  it('reports false for a token that does not exist', async () => {
    assert.equal(await createRefreshTokenRepository().markUsed('missing', 0), false);
  });

  it('revokes every token in the family and nothing else', async () => {
    const repo = createRefreshTokenRepository();
    await repo.create(token('a1', 'fa'), 0);
    await repo.create(token('a2', 'fa'), 0);
    await repo.create(token('b1', 'fb'), 0);

    await repo.revokeFamily('fa', 7);
    await repo.revokeFamily('fa', 9);

    assert.equal((await repo.findById('a1'))?.revokedAt, 7, 'the first revocation time is kept');
    assert.equal((await repo.findById('a2'))?.revokedAt, 7);
    assert.equal((await repo.findById('b1'))?.revokedAt, null);
  });

  it('treats a token written into an already revoked family as revoked', async () => {
    const repo = createRefreshTokenRepository();
    await repo.create(token('a1', 'fa'), 0);
    await repo.revokeFamily('fa', 7);

    await repo.create(token('a2', 'fa'), 8);
    assert.equal((await repo.findById('a2'))?.revokedAt, 7);
  });

  it('drops expired tokens when a new one is written', async () => {
    const repo = createRefreshTokenRepository();
    await repo.create(token('old', 'f1', 100), 0);
    await repo.create(token('live', 'f1', 500), 0);

    await repo.create(token('new', 'f2', 900), 100);

    assert.equal(await repo.findById('old'), undefined);
    assert.ok(await repo.findById('live'));
  });
});
