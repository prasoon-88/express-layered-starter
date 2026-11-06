import { randomUUID } from 'node:crypto';
import APP_ERROR_CODES from '#constants/error/appErrorCodes.constant';
import type { UserRole } from '#constants/user.constant';
import { ConflictError } from '#errors';

export interface NewUser {
  fullName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface StoredUser extends NewUser {
  id: string;
}

// In-memory until a database branch replaces this file. Async because every real DB call is.
// Each call owns its own store, so two apps (or two tests) never share users.
export const createUserRepository = () => {
  const usersByEmail = new Map<string, StoredUser>();
  const usersById = new Map<string, StoredUser>();

  // The uniqueness check lives here, in the same synchronous step as the insert, the way a unique
  // index does. A check in the service would race: it awaits between "is it free" and "save".
  const create = (data: NewUser): Promise<StoredUser> => {
    if (usersByEmail.has(data.email))
      return Promise.reject(
        new ConflictError('Email already registered', APP_ERROR_CODES.EMAIL_TAKEN),
      );

    const user: StoredUser = { id: randomUUID(), ...data };
    usersByEmail.set(user.email, user);
    usersById.set(user.id, user);
    return Promise.resolve(user);
  };

  const findByEmail = (email: string): Promise<StoredUser | undefined> =>
    Promise.resolve(usersByEmail.get(email));

  const findById = (id: string): Promise<StoredUser | undefined> =>
    Promise.resolve(usersById.get(id));

  return { create, findByEmail, findById };
};

export type UserRepository = ReturnType<typeof createUserRepository>;
