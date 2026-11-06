import type { Registry } from '#http/registry';
import { defineRoute } from '#http/routes';

export const homeRoutes = ({ homeController }: Pick<Registry, 'homeController'>) =>
  defineRoute({
    method: 'get',
    path: '/',
    access: { strategy: 'public', reason: 'Landing page, shown before sign-in' },
    handlers: [homeController.getHome],
  });
