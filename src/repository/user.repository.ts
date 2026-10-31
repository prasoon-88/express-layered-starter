export interface CreateUserInput {
  fullName: string;
  email: string;
  password: string;
}

// Placeholder until a database is wired in. Async because every real DB call is.
const create = (_data: CreateUserInput): Promise<void> => Promise.resolve();

const userRepository = {
  create,
};

export default userRepository;
