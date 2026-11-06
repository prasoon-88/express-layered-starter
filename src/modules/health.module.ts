import { createHealthController, type HealthController } from '#controllers/health/index';
import { defineModule } from '#http/routes';
import { healthRoutes } from '#routes/health/index';

declare module '#http/registry' {
  interface Registry {
    healthController: HealthController;
  }
}

export const healthModule = defineModule({
  name: 'health',
  providers: {
    healthController: (get) => createHealthController({ checks: get('readinessChecks') }),
  },
  needs: ['healthController'],
  routes: healthRoutes,
});
