import { createDocsController, type DocsController } from '#controllers/api/docs.controller';
import { defineModule } from '#http/routes';
import { docsRoutes } from '#routes/api/docs.routes';

declare module '#http/registry' {
  interface Registry {
    docsController: DocsController;
  }
}

// GET /api/docs/openapi.json, generated from the route table that mount provides.
export const docsModule = defineModule({
  name: 'docs',
  providers: {
    docsController: (get) => {
      const env = get('env');
      return createDocsController({
        routeTable: get('routeTable'),
        title: env.SERVICE_NAME,
        version: env.SERVICE_VERSION,
      });
    },
  },
  needs: ['docsController'],
  routes: docsRoutes,
});
