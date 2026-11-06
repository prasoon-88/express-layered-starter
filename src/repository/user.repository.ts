import { randomUUID } from 'node:crypto';
import { APP_ERROR_CODES } from '#constants/error/appErrorCodes.constant';
import type { UserRole } from '#constants/user.constant';
import { ConflictError } from '#errors';

export type NewUser = {
  fullName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
};

export type StoredUser = NewUser & {
  id: string;
  /**
   * Starts at 0. Raising it ends every session: refresh refuses a token issued under an older
   * value. On a database, an integer column updated in the same statement as the change.
   */
  sessionVersion: number;
};

// In-memory until a database branch replaces this file. Async because every real DB call is.
// Each call owns its own store, so two apps (or two tests) never share users.
export const createUserRepository = () => {
  const usersByEmail = new Map<string, StoredUser>();
  const usersById = new Map<string, StoredUser>();

  // Updates replace the row in both maps, so a caller holding an earlier row never sees it change.
  const save = (user: StoredUser) => {
    usersByEmail.set(user.email, user);
    usersById.set(user.id, user);
  };

  // The uniqueness check lives here, in the same synchronous step as the insert, the way a unique
  // index does. A check in the service would race: it awaits between "is it free" and "save".
  const create = (data: NewUser): Promise<StoredUser> => {
    if (usersByEmail.has(data.email))
      return Promise.reject(
        new ConflictError('Email already registered', APP_ERROR_CODES.EMAIL_TAKEN),
      );

    const user: StoredUser = { id: randomUUID(), ...data, sessionVersion: 0 };
    save(user);
    return Promise.resolve(user);
  };

  const findByEmail = (email: string): Promise<StoredUser | undefined> =>
    Promise.resolve(usersByEmail.get(email));

  const findById = (id: string): Promise<StoredUser | undefined> =>
    Promise.resolve(usersById.get(id));

  // Compare-and-set, like `UPDATE ... WHERE id = ? AND password_hash = ?`: of two changes racing
  // from the same current password, one wins and the other gets undefined. Ends every session.
  const updatePassword = (
    id: string,
    expectedHash: string,
    passwordHash: string,
  ): Promise<StoredUser | undefined> => {
    const user = usersById.get(id);
    if (!user || user.passwordHash !== expectedHash) return Promise.resolve(undefined);

    const updated = { ...user, passwordHash, sessionVersion: user.sessionVersion + 1 };
    save(updated);
    return Promise.resolve(updated);
  };

  // `UPDATE ... SET session_version = session_version + 1`: concurrent calls never lose a bump.
  const endSessions = (id: string): Promise<StoredUser | undefined> => {
    const user = usersById.get(id);
    if (!user) return Promise.resolve(undefined);

    const updated = { ...user, sessionVersion: user.sessionVersion + 1 };
    save(updated);
    return Promise.resolve(updated);
  };

  return { create, findByEmail, findById, updatePassword, endSessions };
};

export type UserRepository = ReturnType<typeof createUserRepository>;
