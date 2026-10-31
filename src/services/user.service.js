import userRepository from '#repository/user.repository.js';
import { BadRequestError } from '#errors';

const REGISTER_REQUIRED_FIELDS = ['fullName', 'email', 'password'];

const registerUser = async (data) => {
  const missing = REGISTER_REQUIRED_FIELDS.filter((field) => !data[field]);
  if (missing.length) {
    throw new BadRequestError(`Missing required fields: ${missing.join(', ')}`);
  }

  return userRepository.create(data);
};

const userService = {
  registerUser,
};

export default userService;
