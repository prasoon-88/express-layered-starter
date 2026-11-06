import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';
import { noStoreMiddleware } from '#middlewares/noStore.middleware';

const probe = { strategy: 'public', reason: 'Platform probes carry no credentials' } as const;

export const healthRoutes = ({ healthController }: Pick<Registry, 'healthController'>) =>
  defineGroup(
    '/health',
    [
      defineRoute({ method: 'get', path: '/', access: probe, handlers: [healthController.ready] }),
      defineRoute({
        method: 'get',
        path: '/ready',
        access: probe,
        handlers: [healthController.ready],
      }),
      defineRoute({
        method: 'get',
        path: '/live',
        access: probe,
        handlers: [healthController.live],
      }),
    ],
    { use: [noStoreMiddleware] },
  );
