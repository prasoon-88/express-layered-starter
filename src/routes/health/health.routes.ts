import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';

const probe = { strategy: 'public', reason: 'Platform probes carry no credentials' } as const;
const noStore = { mode: 'no-store' } as const;

export const healthRoutes = ({ healthController }: Pick<Registry, 'healthController'>) =>
  defineGroup('/health', [
    defineRoute({
      method: 'get',
      path: '/',
      access: probe,
      cache: noStore,
      handlers: [healthController.ready],
    }),
    defineRoute({
      method: 'get',
      path: '/ready',
      access: probe,
      cache: noStore,
      handlers: [healthController.ready],
    }),
    defineRoute({
      method: 'get',
      path: '/live',
      access: probe,
      cache: noStore,
      handlers: [healthController.live],
    }),
  ]);
