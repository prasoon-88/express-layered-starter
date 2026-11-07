import { APP_ERROR_CODES } from '#constants/error/appErrorCodes.constant';
import { UnauthorizedError } from '#errors';
import { userProfileCacheSpec } from '#cache/user.cache';
import type { Cache, SpecOutput } from '#lib/cache/index';
import type { UserRepository } from '#repository/user.repository';
import { hashPassword } from '#utils/password.util';

export type RegisterUserInput = {
  fullName: string;
  email: string;
  password: string;
};

export type RegisteredUser = {
  id: string;
  fullName: string;
  email: string;
};

/** Defined once, by the cache spec's schema: what is cached is exactly what is returned. */
export type UserProfile = SpecOutput<typeof userProfileCacheSpec>;

type UserServiceDeps = {
  userRepository: Pick<UserRepository, 'create' | 'findById'>;
  cache: Cache;
};

export const createUserService = ({ userRepository, cache }: UserServiceDeps) => {
  const profiles = cache.entity(userProfileCacheSpec);

  // Shape (required, formats, lengths) is the controller's schema. What remains here is the rule:
  // an email can be registered once, which the repository enforces when it saves.
  const registerUser = async ({
    fullName,
    email,
    password,
  }: RegisterUserInput): Promise<RegisteredUser> => {
    const user = await userRepository.create({
      fullName,
      email,
      passwordHash: await hashPassword(password),
      role: 'NORMAL',
    });

    return { id: user.id, fullName: user.fullName, email: user.email };
  };

  // Cached: the public fields only. A missing account is never cached, so it is read every time.
  const getProfile = async (id: string): Promise<UserProfile> => {
    const options = { key: ['byId', id], tags: [profiles.tags.one(id)] };
    const profile = await profiles.query(options, async () => {
      const user = await userRepository.findById(id);
      return user && { id: user.id, fullName: user.fullName, email: user.email, role: user.role };
    });
    // An access token outlives the account it names by up to its ttl. A 401 makes the client
    // refresh, and the refresh fails for a missing user, which ends at the login screen.
    if (!profile)
      throw new UnauthorizedError('Account no longer exists', APP_ERROR_CODES.TOKEN_INVALID);

    return profile;
  };

  return { registerUser, getProfile };
};

export type UserService = ReturnType<typeof createUserService>;
