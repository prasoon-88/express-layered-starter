import userRepository from '#repository/user.repository';
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

const userService = {
  registerUser,
};

export default userService;
