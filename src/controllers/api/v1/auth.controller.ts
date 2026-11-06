import { z } from 'zod';
import { route } from '#lib/http/route';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import { TOKEN_TYPE } from '#constants/auth.constant';
import { newPasswordSchema } from '#schemas/user.schema';
import type { AuthService } from '#services/auth.service';

// An existing password. Same cap as signup: hashing cost grows with input. No minimum beyond 1,
// so a policy change to signup's minimum never locks out accounts created before it.
const currentPassword = z.string().min(1).max(128);

const loginBody = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: currentPassword,
});

// The format is the service's business; this only bounds the input.
const refreshTokenBody = z.strictObject({ refreshToken: z.string().min(1).max(256) });

const changePasswordBody = z
  .strictObject({ currentPassword, newPassword: newPasswordSchema })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ['newPassword'],
    message: 'Must differ from the current password',
  });

const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal(TOKEN_TYPE),
  expiresIn: z.number().int().positive(),
});

type AuthControllerDeps = {
  authService: Pick<AuthService, 'login' | 'refresh' | 'logout' | 'logoutAll' | 'changePassword'>;
};

export const createAuthController = ({ authService }: AuthControllerDeps) => {
  const login = route({ body: loginBody, response: tokenPair }, ({ body }) =>
    authService.login(body),
  );

  const refresh = route({ body: refreshTokenBody, response: tokenPair }, ({ body }) =>
    authService.refresh(body.refreshToken),
  );

  const logout = route(
    { body: refreshTokenBody },
    ({ body }) => authService.logout(body.refreshToken),
    { status: HTTP_STATUS.NO_CONTENT },
  );

  // Mounted behind `authenticated`, so req.user is set.
  const logoutAll = route({}, (_input, req) => authService.logoutAll(req.user.id), {
    status: HTTP_STATUS.NO_CONTENT,
  });

  const changePassword = route({ body: changePasswordBody, response: tokenPair }, ({ body }, req) =>
    authService.changePassword(req.user.id, body),
  );

  return { login, refresh, logout, logoutAll, changePassword };
};

export type AuthController = ReturnType<typeof createAuthController>;
