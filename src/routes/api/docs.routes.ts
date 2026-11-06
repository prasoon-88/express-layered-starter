import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';

export const docsRoutes = ({ docsController }: Pick<Registry, 'docsController'>) =>
  defineGroup('/docs', [
    defineRoute({
      method: 'get',
      path: '/openapi.json',
      access: {
        strategy: 'public',
        reason: 'Describes the API for clients and tooling; holds no user data',
      },
      handlers: [docsController.openApi],
    }),
  ]);
