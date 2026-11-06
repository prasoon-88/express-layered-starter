import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenError, UnauthorizedError } from '#errors';
import type { AccessClaims } from '#lib/auth/accessToken';
import type { StoredUser } from '#repository/user.repository';
import { createRefreshTokenRepository } from '#repository/refreshToken.repository';
import { hashPassword } from '#utils/password.util';
import type { AuthService } from './auth.service.ts';

process.env.NODE_ENV ??= 'test';

const { createAuthService } = await import('./auth.service.ts');

const PASSWORD = 'correct-horse-1';
const REFRESH_TTL_S = 3600;

const rejectsWith = (code: string) => (err: unknown) =>
  err instanceof UnauthorizedError && err.code === code;

describe('authService', () => {
  let users: Map<string, StoredUser>;
  let signed: AccessClaims[];
  let nowMs: number;
  let auth: AuthService;

  const user = (): StoredUser => users.get('u1')!;

  beforeEach(async () => {
    users = new Map([
      [
        'u1',
        {
          id: 'u1',
          fullName: 'Ada',
          email: 'ada@example.com',
          passwordHash: await hashPassword(PASSWORD),
          role: 'NORMAL',
          sessionVersion: 0,
        },
      ],
    ]);
    signed = [];
    nowMs = 1_000_000;
    // Same semantics as user.repository: whole-row replacement, compare-and-set on the hash.
    const replace = (id: string, change: Partial<StoredUser>, when = () => true) => {
      const current = users.get(id);
      if (!current || !when()) return Promise.resolve(undefined);
      const next = { ...current, ...change, sessionVersion: current.sessionVersion + 1 };
      users.set(id, next);
      return Promise.resolve(next);
    };
    auth = createAuthService({
      userRepository: {
        findByEmail: (email) => Promise.resolve([...users.values()].find((u) => u.email === email)),
        findById: (id) => Promise.resolve(users.get(id)),
        updatePassword: (id, expectedHash, passwordHash) =>
          replace(id, { passwordHash }, () => users.get(id)?.passwordHash === expectedHash),
        endSessions: (id) => replace(id, {}),
      },
      refreshTokenRepository: createRefreshTokenRepository(),
      accessTokens: {
        sign: (claims) => {
          signed.push(claims);
          return { token: `access-${signed.length}`, expiresIn: 900 };
        },
      },
      refreshTtlS: REFRESH_TTL_S,
      now: () => nowMs,
    });
  });

  const login = () => auth.login({ email: 'ada@example.com', password: PASSWORD });

  describe('login', () => {
    it('issues an access token for the user and a refresh token', async () => {
      const tokens = await login();

      assert.deepEqual(signed, [{ sub: 'u1', email: 'ada@example.com', role: 'NORMAL' }]);
      assert.equal(tokens.accessToken, 'access-1');
      assert.equal(tokens.tokenType, 'Bearer');
      assert.equal(tokens.expiresIn, 900);
      assert.match(tokens.refreshToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('refuses a wrong password and an unknown email the same way', async () => {
      const wrong = auth.login({ email: 'ada@example.com', password: 'nope-nope-nope' });
      const unknown = auth.login({ email: 'who@example.com', password: PASSWORD });

      const errors = await Promise.allSettled([wrong, unknown]);
      for (const result of errors) {
        assert.equal(result.status, 'rejected');
        assert.ok(rejectsWith('INVALID_CREDENTIALS')(result.reason));
      }
      const [a, b] = errors as PromiseRejectedResult[];
      assert.equal((a!.reason as Error).message, (b!.reason as Error).message);
      assert.equal(signed.length, 0);
    });

    it('starts a separate family per login, so logging out one leaves the other', async () => {
      const phone = await login();
      const laptop = await login();

      await auth.logout(phone.refreshToken);

      await assert.rejects(auth.refresh(phone.refreshToken), rejectsWith('TOKEN_INVALID'));
      await assert.doesNotReject(auth.refresh(laptop.refreshToken));
    });
  });

  describe('refresh', () => {
    it('rotates: returns a new pair and the old refresh token stops working', async () => {
      const first = await login();
      const second = await auth.refresh(first.refreshToken);

      assert.notEqual(second.refreshToken, first.refreshToken);
      assert.equal(second.accessToken, 'access-2');
      await assert.doesNotReject(auth.refresh(second.refreshToken));
    });

    it('treats a reused token as theft and revokes every token in its family', async () => {
      const first = await login();
      const second = await auth.refresh(first.refreshToken);

      await assert.rejects(auth.refresh(first.refreshToken), rejectsWith('TOKEN_INVALID'));
      await assert.rejects(auth.refresh(second.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('lets one of two simultaneous refreshes through; the other counts as reuse', async () => {
      const { refreshToken } = await login();

      const results = await Promise.allSettled([
        auth.refresh(refreshToken),
        auth.refresh(refreshToken),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);

      const winner = results.find((r) => r.status === 'fulfilled')!;
      await assert.rejects(auth.refresh(winner.value.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('refuses an expired token with TOKEN_EXPIRED', async () => {
      const { refreshToken } = await login();
      nowMs += REFRESH_TTL_S * 1000;

      await assert.rejects(auth.refresh(refreshToken), rejectsWith('TOKEN_EXPIRED'));
    });

    it('accepts a token one millisecond before it expires', async () => {
      const { refreshToken } = await login();
      nowMs += REFRESH_TTL_S * 1000 - 1;

      await assert.doesNotReject(auth.refresh(refreshToken));
    });

    for (const token of ['', 'abc', 'a.b', 'a.b.c', '.x', 'x.', 'a b.c'])
      it(`refuses the malformed token ${JSON.stringify(token)}`, async () => {
        await assert.rejects(auth.refresh(token), rejectsWith('TOKEN_INVALID'));
      });

    it('refuses a known id with the wrong secret, without burning the real token', async () => {
      const { refreshToken } = await login();
      const [id] = refreshToken.split('.');

      await assert.rejects(auth.refresh(`${id}.forged`), rejectsWith('TOKEN_INVALID'));
      await assert.doesNotReject(auth.refresh(refreshToken));
    });

    it('signs the role the user has now, not the one they had at login', async () => {
      const { refreshToken } = await login();
      user().role = 'ADMIN';

      await auth.refresh(refreshToken);
      assert.equal(signed.at(-1)?.role, 'ADMIN');
    });

    it('refuses and revokes when the user no longer exists', async () => {
      const { refreshToken } = await login();
      users.clear();

      await assert.rejects(auth.refresh(refreshToken), rejectsWith('TOKEN_INVALID'));
    });
  });

  describe('logout', () => {
    it('revokes the whole family, including tokens rotated from it', async () => {
      const first = await login();
      const second = await auth.refresh(first.refreshToken);

      await auth.logout(second.refreshToken);
      await assert.rejects(auth.refresh(second.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('succeeds for an unknown, forged, malformed or already revoked token', async () => {
      const { refreshToken } = await login();
      const [id] = refreshToken.split('.');

      for (const token of ['', 'garbage', `${id}.forged`, refreshToken, refreshToken])
        await assert.doesNotReject(auth.logout(token), token);
    });

    it('ignores a forged secret, so it cannot log someone else out', async () => {
      const { refreshToken } = await login();
      const [id] = refreshToken.split('.');

      await auth.logout(`${id}.forged`);
      await assert.doesNotReject(auth.refresh(refreshToken));
    });
  });

  describe('logoutAll', () => {
    it('ends every session of the user, including tokens rotated before it', async () => {
      const phone = await login();
      const laptop = await auth.refresh((await login()).refreshToken);

      await auth.logoutAll('u1');

      await assert.rejects(auth.refresh(phone.refreshToken), rejectsWith('TOKEN_INVALID'));
      await assert.rejects(auth.refresh(laptop.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('leaves a login made afterwards working', async () => {
      await auth.logoutAll('u1');
      const { refreshToken } = await login();

      await assert.doesNotReject(auth.refresh(refreshToken));
    });

    it('also ends a login that had read the user before it ran', async () => {
      // login() has read the user and is still hashing when logoutAll runs.
      const pending = login();
      await auth.logoutAll('u1');
      const { refreshToken } = await pending;

      await assert.rejects(auth.refresh(refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('revokes the family once refused, so it stays refused', async () => {
      const { refreshToken } = await login();
      await auth.logoutAll('u1');
      await assert.rejects(auth.refresh(refreshToken));

      users.set('u1', { ...user(), sessionVersion: 0 });
      await assert.rejects(auth.refresh(refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('succeeds for an account that no longer exists', async () => {
      users.clear();
      await assert.doesNotReject(auth.logoutAll('u1'));
    });
  });

  describe('changePassword', () => {
    const NEW_PASSWORD = 'battery-staple-2';
    const change = (currentPassword = PASSWORD, newPassword = NEW_PASSWORD) =>
      auth.changePassword('u1', { currentPassword, newPassword });
    const forbidden = (err: unknown) =>
      err instanceof ForbiddenError && err.code === 'INVALID_CREDENTIALS';

    it('returns a working pair and ends every other session', async () => {
      const other = await login();

      const tokens = await change();

      await assert.doesNotReject(auth.refresh(tokens.refreshToken));
      await assert.rejects(auth.refresh(other.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('replaces the password used to log in', async () => {
      await change();

      await assert.rejects(login(), rejectsWith('INVALID_CREDENTIALS'));
      await assert.doesNotReject(auth.login({ email: 'ada@example.com', password: NEW_PASSWORD }));
    });

    it('refuses a wrong current password with a 403, changing nothing', async () => {
      const other = await login();

      await assert.rejects(change('wrong-password-0'), forbidden);

      await assert.doesNotReject(login());
      await assert.doesNotReject(auth.refresh(other.refreshToken));
    });

    it('lets one of two simultaneous changes win; the other is refused', async () => {
      const results = await Promise.allSettled([
        change(PASSWORD, 'first-new-pass-1'),
        change(PASSWORD, 'second-new-pass-2'),
      ]);

      assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
      assert.ok(forbidden(results.find((r) => r.status === 'rejected')!.reason));
    });

    it('answers 401 TOKEN_INVALID when the account no longer exists', async () => {
      users.clear();
      await assert.rejects(change(), rejectsWith('TOKEN_INVALID'));
    });
  });
});
