import userRepository, { type CreateUserInput } from '#repository/user.repository';
import { BadRequestError } from '#errors';

const REGISTER_REQUIRED_FIELDS = [
  'fullName',
  'email',
  'password',
] as const satisfies readonly (keyof CreateUserInput)[];

// Type guard: after this returns true, TypeScript knows `data` is a complete CreateUserInput.
const hasRequiredFields = (data: Partial<CreateUserInput>): data is CreateUserInput =>
  REGISTER_REQUIRED_FIELDS.every((field) => Boolean(data[field]));

// Input comes from a request body, so any field may be missing until validated.
const registerUser = async (data: Partial<CreateUserInput>) => {
  if (!hasRequiredFields(data)) {
    const missing = REGISTER_REQUIRED_FIELDS.filter((field) => !data[field]);
    throw new BadRequestError(`Missing required fields: ${missing.join(', ')}`);
  }

  await userRepository.create(data);
};

const userService = {
  registerUser,
};

export default userService;
