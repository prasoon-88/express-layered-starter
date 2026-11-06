import { APP_ERROR_CODES } from '#constants/error/appErrorCodes.constant';
import type { UserRole } from '#constants/user.constant';
import { UnauthorizedError } from '#errors';
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

export type UserProfile = RegisteredUser & {
  role: UserRole;
};

type UserServiceDeps = {
  userRepository: Pick<UserRepository, 'create' | 'findById'>;
};

export const createUserService = ({ userRepository }: UserServiceDeps) => {
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

  const getProfile = async (id: string): Promise<UserProfile> => {
    const user = await userRepository.findById(id);
    // An access token outlives the account it names by up to its ttl. A 401 makes the client
    // refresh, and the refresh fails for a missing user, which ends at the login screen.
    if (!user)
      throw new UnauthorizedError('Account no longer exists', APP_ERROR_CODES.TOKEN_INVALID);

    return { id: user.id, fullName: user.fullName, email: user.email, role: user.role };
  };

  return { registerUser, getProfile };
};

export type UserService = ReturnType<typeof createUserService>;
