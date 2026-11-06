import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';
import { noStoreMiddleware } from '#middlewares/noStore.middleware';

type UserRoutesDeps = Pick<Registry, 'userController' | 'limit' | 'idempotent'>;

export const userRoutes = ({ userController, limit, idempotent }: UserRoutesDeps) =>
  defineGroup('/user', [
    defineRoute({
      method: 'post',
      path: '/register',
      access: { strategy: 'public', reason: 'Account signup: the caller has no credentials yet' },
      // Credential endpoints get the strict `auth` policy, not just the global one.
      handlers: [limit('auth'), idempotent('default'), userController.register],
    }),
    defineRoute({
      method: 'get',
      path: '/me',
      access: { strategy: 'authenticated' },
      // In `pre`, so the 401 from the access check is not cached either.
      pre: [noStoreMiddleware],
      handlers: [userController.me],
    }),
  ]);
