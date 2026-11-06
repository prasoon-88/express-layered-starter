import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';

export const signupRoutes = ({ signupController }: Pick<Registry, 'signupController'>) =>
  defineGroup('/signup', [
    defineRoute({
      method: 'get',
      path: '/',
      access: { strategy: 'public', reason: 'Signup form, shown before an account exists' },
      handlers: [signupController.getSignup],
    }),
  ]);
