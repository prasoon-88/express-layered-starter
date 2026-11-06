import type { UserRepository } from '#repository/user.repository';
import { hashPassword } from '#utils/password.util';

export interface RegisterUserInput {
  fullName: string;
  email: string;
  password: string;
}

export interface RegisteredUser {
  id: string;
  fullName: string;
  email: string;
}

type UserServiceDeps = {
  userRepository: Pick<UserRepository, 'create'>;
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
    });

    return { id: user.id, fullName: user.fullName, email: user.email };
  };

  return { registerUser };
};

export type UserService = ReturnType<typeof createUserService>;
