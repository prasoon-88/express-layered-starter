import { z } from 'zod';
import { route } from '#lib/http/route.lib';
import REGEX from '#constants/regex.constant';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import { USER_ROLES } from '#constants/user.constant';
import { newPasswordSchema } from '#schemas/user.schema';
import type { UserService } from '#services/user.service';

// Endpoint-only schemas: they stay here until a second file needs them.
const registerBody = z.strictObject({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: newPasswordSchema,
});

// Never the hash: only these fields ever leave the server.
const registeredUser = z.object({
  id: z.string().regex(REGEX.SAFE_ID),
  fullName: z.string(),
  email: z.email(),
});

const profile = registeredUser.extend({ role: z.enum(USER_ROLES) });

type UserControllerDeps = {
  userService: Pick<UserService, 'registerUser' | 'getProfile'>;
};

export const createUserController = ({ userService }: UserControllerDeps) => {
  const register = route(
    { body: registerBody, response: registeredUser },
    ({ body }) => userService.registerUser(body),
    { status: HTTP_STATUS.CREATED },
  );

  // Mounted behind `authenticated`, so req.user is set.
  const me = route({ response: profile }, (_input, req) => userService.getProfile(req.user.id));

  return { register, me };
};

export type UserController = ReturnType<typeof createUserController>;
