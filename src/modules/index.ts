import { healthModule } from './health.module.ts';
import { webModule } from './web.module.ts';
import { userModule } from './user.module.ts';
import { authModule } from './auth.module.ts';

// Where each feature sits in the route tree in app.ts. Order is the order Express tries them in.

/** Mounted before the global rate limit and the request timeout. */
export const probeModules = [healthModule];

/** Server-rendered pages. */
export const pageModules = [webModule];

/** Served under /api/v1. */
export const apiV1Modules = [authModule, userModule];
