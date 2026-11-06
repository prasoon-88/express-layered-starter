import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import APP_ERROR_CODES from '#constants/error/appErrorCodes.constant';
import { TOKEN_TYPE } from '#constants/auth.constant';
import REGEX from '#constants/regex.constant';
import { ForbiddenError, UnauthorizedError } from '#errors';
import type { AccessTokens } from '#lib/auth/accessToken';
import { getLogger } from '#lib/logger/index';
import type { RefreshTokenRepository } from '#repository/refreshToken.repository';
import type { StoredUser, UserRepository } from '#repository/user.repository';
import { hashPassword, verifyPassword } from '#utils/password.util';

const logger = getLogger('auth.service');

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: typeof TOKEN_TYPE;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

type AuthServiceDeps = {
  userRepository: Pick<
    UserRepository,
    'findByEmail' | 'findById' | 'updatePassword' | 'endSessions'
  >;
  refreshTokenRepository: RefreshTokenRepository;
  accessTokens: Pick<AccessTokens, 'sign'>;
  refreshTtlS: number;
  /** Milliseconds since the epoch. Injectable so expiry is testable without waiting. */
  now?: () => number;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest();

const parseRefreshToken = (token: string) => {
  const match = REGEX.REFRESH_TOKEN.exec(token);
  return match ? { id: match[1]!, secret: match[2]! } : undefined;
};

// Hashed once per process, on the first login for an unknown email. Verifying against it makes
// that login cost one scrypt, the same as a wrong password, so timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

const invalidCredentials = () =>
  new UnauthorizedError('Invalid email or password', APP_ERROR_CODES.INVALID_CREDENTIALS);
const invalidToken = () =>
  new UnauthorizedError('Invalid refresh token', APP_ERROR_CODES.TOKEN_INVALID);
// Same as getProfile: the access token outlived its account, so the client ends at login.
const accountGone = () =>
  new UnauthorizedError('Account no longer exists', APP_ERROR_CODES.TOKEN_INVALID);
// A 403, not a 401: the access token is fine, and a 401 would make the client try a refresh.
const wrongCurrentPassword = () =>
  new ForbiddenError('Current password is incorrect', APP_ERROR_CODES.INVALID_CREDENTIALS);

export const createAuthService = ({
  userRepository,
  refreshTokenRepository,
  accessTokens,
  refreshTtlS,
  now = Date.now,
}: AuthServiceDeps) => {
  const issue = async (user: StoredUser, familyId: string): Promise<TokenPair> => {
    const id = randomBytes(16).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const issuedAt = now();

    await refreshTokenRepository.create(
      {
        id,
        userId: user.id,
        familyId,
        sessionVersion: user.sessionVersion,
        hash: sha256(secret).toString('hex'),
        expiresAt: issuedAt + refreshTtlS * 1000,
      },
      issuedAt,
    );

    const access = accessTokens.sign({ sub: user.id, email: user.email, role: user.role });
    return {
      accessToken: access.token,
      refreshToken: `${id}.${secret}`,
      tokenType: TOKEN_TYPE,
      expiresIn: access.expiresIn,
    };
  };

  // The stored row, only when the secret matches. A wrong secret changes nothing, so somebody
  // who knows (or guesses) an id cannot burn or revoke another person's token with it.
  const findGenuine = async (token: string) => {
    const parsed = parseRefreshToken(token);
    if (!parsed) return undefined;

    const stored = await refreshTokenRepository.findById(parsed.id);
    if (!stored) return undefined;

    const matches = timingSafeEqual(sha256(parsed.secret), Buffer.from(stored.hash, 'hex'));
    return matches ? stored : undefined;
  };

  const login = async ({ email, password }: LoginInput): Promise<TokenPair> => {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw invalidCredentials();
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw invalidCredentials();

    return issue(user, randomUUID());
  };

  const refresh = async (token: string): Promise<TokenPair> => {
    const stored = await findGenuine(token);
    if (!stored || stored.revokedAt !== null) throw invalidToken();
    if (stored.expiresAt <= now())
      throw new UnauthorizedError('Refresh token expired', APP_ERROR_CODES.TOKEN_EXPIRED);

    // A token can rotate once. A second use means two parties hold it, and the server cannot
    // tell which is the owner, so the whole family is revoked and both must log in again.
    if (!(await refreshTokenRepository.markUsed(stored.id, now()))) {
      await refreshTokenRepository.revokeFamily(stored.familyId, now());
      logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        'refresh token reused; family revoked',
      );
      throw invalidToken();
    }

    // Read again: the role or the account may have changed since the last token was signed, and
    // a password change or "log out everywhere" since this login raised sessionVersion.
    const user = await userRepository.findById(stored.userId);
    if (!user || user.sessionVersion !== stored.sessionVersion) {
      await refreshTokenRepository.revokeFamily(stored.familyId, now());
      throw invalidToken();
    }

    return issue(user, stored.familyId);
  };

  // Always succeeds: logging out must not reveal whether a token was ever valid.
  const logout = async (token: string): Promise<void> => {
    const stored = await findGenuine(token);
    if (stored) await refreshTokenRepository.revokeFamily(stored.familyId, now());
  };

  // Ends every session of the user, this one included. Nothing is looked up in the token store:
  // each refresh token is refused at its next use, because it carries the old sessionVersion.
  // A login that read the user before this ran carries the old version too, so it is ended as well.
  const logoutAll = async (userId: string): Promise<void> => {
    await userRepository.endSessions(userId);
  };

  // Ends every other session and returns a pair for a new one, so the caller stays signed in.
  const changePassword = async (
    userId: string,
    { currentPassword, newPassword }: ChangePasswordInput,
  ): Promise<TokenPair> => {
    const user = await userRepository.findById(userId);
    if (!user) throw accountGone();

    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw wrongCurrentPassword();

    const updated = await userRepository.updatePassword(
      user.id,
      user.passwordHash,
      await hashPassword(newPassword),
    );
    if (updated) return issue(updated, randomUUID());

    // Changed or deleted since it was read: by a concurrent change that won, so the password
    // just checked is no longer the current one.
    throw (await userRepository.findById(userId)) ? wrongCurrentPassword() : accountGone();
  };

  return { login, refresh, logout, logoutAll, changePassword };
};

export type AuthService = ReturnType<typeof createAuthService>;
