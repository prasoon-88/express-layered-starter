import { homeController } from '#controllers/web/home.controller';
import { signupController } from '#controllers/web/signup.controller';
import { defineModule } from '#http/routes';
import { webRoutes } from '#routes/web/index';

declare module '#http/registry' {
  interface Registry {
    homeController: typeof homeController;
    signupController: typeof signupController;
  }
}

export const webModule = defineModule({
  name: 'web',
  providers: {
    homeController: () => homeController,
    signupController: () => signupController,
  },
  needs: ['homeController', 'signupController'],
  routes: webRoutes,
});
