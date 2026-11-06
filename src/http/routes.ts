import type { RequestHandler } from 'express';
import type { Access, Key, Providers, Registry } from './registry.ts';

export const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

type Handlers = readonly [...RequestHandler[], RequestHandler];

export type RouteDef = Readonly<{
  kind: 'route';
  method: RouteMethod;
  path: string;
  access: Access;
  /** Runs before the access check, such as a rate limit that must also count rejected callers. */
  pre: readonly RequestHandler[];
  /** Runs after the access check. The last one is the controller. */
  handlers: Handlers;
}>;

export type GroupDef = Readonly<{
  kind: 'group';
  prefix: string;
  /** Runs for every request under the prefix, including ones no route matches. */
  use: readonly RequestHandler[];
  children: readonly RouteNode[];
}>;

export type ModuleDef = Readonly<{
  kind: 'module';
  name: string;
  providers: Providers;
  needs: readonly Key[];
  routes: (deps: Registry) => RouteDef | GroupDef;
}>;

export type RouteNode = RouteDef | GroupDef | ModuleDef;

export const defineRoute = (route: {
  method: RouteMethod;
  path: string;
  access: Access;
  pre?: readonly RequestHandler[];
  handlers: Handlers;
}): RouteDef =>
  Object.freeze({
    kind: 'route',
    method: route.method,
    path: route.path,
    access: route.access,
    pre: Object.freeze([...(route.pre ?? [])]),
    handlers: route.handlers,
  });

export const defineGroup = (
  prefix: string,
  children: readonly RouteNode[],
  options: { use?: readonly RequestHandler[] } = {},
): GroupDef =>
  Object.freeze({
    kind: 'group',
    prefix,
    use: Object.freeze([...(options.use ?? [])]),
    children: Object.freeze([...children]),
  });

/**
 * One feature: what it registers in the container, what it takes back out, and its routes.
 * `routes` receives exactly the keys listed in `needs`, typed.
 */
export const defineModule = <const N extends Key>(module: {
  name: string;
  providers?: Providers;
  needs: readonly N[];
  routes: (deps: Pick<Registry, N>) => RouteDef | GroupDef;
}): ModuleDef =>
  Object.freeze({
    kind: 'module',
    name: module.name,
    providers: Object.freeze({ ...module.providers }),
    needs: Object.freeze([...module.needs]),
    routes: module.routes,
  });
