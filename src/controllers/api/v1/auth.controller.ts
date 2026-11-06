import { z } from 'zod';
import { route } from '#lib/http/route.lib';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import { TOKEN_TYPE } from '#constants/auth.constant';
import type { AuthService } from '#services/auth.service';

const loginBody = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // Same cap as signup: hashing cost grows with input. No minimum beyond 1, so a policy change
  // to signup's minimum never locks out accounts created before it.
  password: z.string().min(1).max(128),
});

// The format is the service's business; this only bounds the input.
const refreshTokenBody = z.strictObject({ refreshToken: z.string().min(1).max(256) });

const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal(TOKEN_TYPE),
  expiresIn: z.number().int().positive(),
});

type AuthControllerDeps = {
  authService: Pick<AuthService, 'login' | 'refresh' | 'logout'>;
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

  return { login, refresh, logout };
};

export type AuthController = ReturnType<typeof createAuthController>;
