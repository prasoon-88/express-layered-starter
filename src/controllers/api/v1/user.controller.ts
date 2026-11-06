import { z } from 'zod';
import { route } from '#lib/http/route.lib';
import REGEX from '#constants/regex.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import type { UserService } from '#services/user.service';

// Endpoint-only schemas: they stay here until a second file needs them.
const registerBody = z.strictObject({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // Capped because hashing cost grows with input, and an uncapped field is a cheap way to burn CPU.
  password: z.string().min(8).max(128),
});

// Never the hash: only these fields ever leave the server.
const registeredUser = z.object({
  id: z.string().regex(REGEX.SAFE_ID),
  fullName: z.string(),
  email: z.email(),
});

type UserControllerDeps = {
  userService: Pick<UserService, 'registerUser'>;
};

export const createUserController = ({ userService }: UserControllerDeps) => {
  const register = route(
    { body: registerBody, response: registeredUser },
    ({ body }) => userService.registerUser(body),
    { status: HTTP_STATUS.CREATED },
  );

  return { register };
};

export type UserController = ReturnType<typeof createUserController>;
