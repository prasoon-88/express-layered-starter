import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';
import { noStoreMiddleware } from '#middlewares/noStore.middleware';

type AuthRoutesDeps = Pick<Registry, 'authController' | 'limit'>;

// No idempotency on purpose: replaying a stored response would hand out the same tokens again,
// and keeping them in the idempotency store would put live credentials in a second place.
export const authRoutes = ({ authController, limit }: AuthRoutesDeps) => {
  // Only failures count, so a client refreshing every few minutes never runs into the limit.
  const credentialLimit = () => limit({ policy: 'auth', refundOnSuccess: true });

  return defineGroup(
    '/auth',
    [
      defineRoute({
        method: 'post',
        path: '/login',
        access: { strategy: 'public', reason: 'Login: the caller has no token yet' },
        handlers: [credentialLimit(), authController.login],
      }),
      defineRoute({
        method: 'post',
        path: '/refresh',
        access: {
          strategy: 'public',
          reason: 'The refresh token in the body is the credential; the access token has expired',
        },
        handlers: [credentialLimit(), authController.refresh],
      }),
      defineRoute({
        method: 'post',
        path: '/logout',
        access: {
          strategy: 'public',
          reason: 'The refresh token in the body is the credential; logout must work after expiry',
        },
        handlers: [credentialLimit(), authController.logout],
      }),
      defineRoute({
        method: 'post',
        path: '/logout-all',
        access: { strategy: 'authenticated' },
        handlers: [authController.logoutAll],
      }),
      defineRoute({
        method: 'post',
        path: '/password',
        access: { strategy: 'authenticated' },
        // A wrong current password counts, so a stolen access token cannot be used to guess it.
        handlers: [credentialLimit(), authController.changePassword],
      }),
    ],
    { use: [noStoreMiddleware] },
  );
};
