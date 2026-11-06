import {
  createHealthController,
  type HealthController,
} from '#controllers/health/health.controller';
import { defineModule } from '#http/routes';
import { healthRoutes } from '#routes/health/health.routes';

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
