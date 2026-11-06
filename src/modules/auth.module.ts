import { createAuthController, type AuthController } from '#controllers/api/v1/auth.controller';
import { defineModule } from '#http/routes';
import { createAccessTokens, type AccessTokens } from '#lib/auth/accessToken';
import { createAuthenticateMiddleware } from '#middlewares/authenticate.middleware';
import {
  createRefreshTokenRepository,
  type RefreshTokenRepository,
} from '#repository/refreshToken.repository';
import { createRedisRefreshTokenRepository } from '#repository/refreshToken.redis.repository';
import { authRoutes } from '#routes/api/v1/auth.routes';
import { createAuthService, type AuthService } from '#services/auth.service';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import { MS_PER_SECOND } from '#constants/time.constant';

declare module '#http/registry' {
  interface Registry {
    accessTokens: AccessTokens;
    refreshTokenRepository: RefreshTokenRepository;
    authService: AuthService;
    authController: AuthController;
  }
}

// Also provides `authenticate`, which the `authenticated` and `roles` strategies run.
// It needs `userRepository` from the user module.
export const authModule = defineModule({
  name: 'auth',
  providers: {
    accessTokens: (get) => {
      const env = get('env');
      return createAccessTokens({
        secret: env.JWT_SECRET,
        // This service both issues and accepts the token. A second service sharing the secret
        // must use its own name, so a token issued for one is refused by the other.
        issuer: env.SERVICE_NAME,
        audience: env.SERVICE_NAME,
        ttlS: env.JWT_ACCESS_TTL_S,
      });
    },
    refreshTokenRepository: (get) => {
      const env = get('env');
      if (env.AUTH_STORE === 'memory') return createRefreshTokenRepository();
      return createRedisRefreshTokenRepository({
        redis: get('redis'),
        prefix: concatenateStrings([env.SERVICE_NAME, 'auth'], ':'),
        familyTtlMs: env.JWT_REFRESH_TTL_S * MS_PER_SECOND,
      });
    },
    authService: (get) =>
      createAuthService({
        userRepository: get('userRepository'),
        refreshTokenRepository: get('refreshTokenRepository'),
        accessTokens: get('accessTokens'),
        refreshTtlS: get('env').JWT_REFRESH_TTL_S,
      }),
    authController: (get) => createAuthController({ authService: get('authService') }),
    authenticate: (get) => createAuthenticateMiddleware({ accessTokens: get('accessTokens') }),
  },
  needs: ['authController', 'limit'],
  routes: authRoutes,
});
