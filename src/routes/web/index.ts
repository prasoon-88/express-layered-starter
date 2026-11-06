import { urlencoded } from 'express';
import type { Registry } from '#http/registry';
import { defineGroup } from '#http/routes';
import { homeRoutes } from './home.routes.ts';
import { signupRoutes } from './signup.routes.ts';

export const webRoutes = (deps: Pick<Registry, 'homeController' | 'signupController'>) =>
  defineGroup('/', [homeRoutes(deps), signupRoutes(deps)], {
    use: [urlencoded({ extended: false })],
  });
