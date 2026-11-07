import { Router, type RequestHandler } from 'express';
import { HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import {
  DEFAULT_GET_CACHE_POLICY,
  cacheHeaders,
  cachePolicyProblem,
  type CachePolicy,
} from './cachePolicy.ts';
import type { Container } from './container.ts';
import { RouteDefinitionError } from './errors.ts';
import { duplicateParam, joinPaths, pathProblem, shadows } from './paths.ts';
import type { Access, Factory, Key, Registry, StrategyName } from './registry.ts';
import {
  ROUTE_METHODS,
  type GroupDef,
  type ModuleDef,
  type RouteDef,
  type RouteMethod,
  type RouteNode,
} from './routes.ts';
import type { AccessStrategy, Strategies } from './strategies.ts';

export type RouteManifestEntry = Readonly<{
  method: Uppercase<RouteMethod>;
  path: string;
  access: Access;
  /** The rule applied: the declared one, or the default for a GET. Absent on a non-GET without one. */
  cache?: CachePolicy;
  module?: string;
  /** The last handler. Built with `route()`, it carries the schemas the OpenAPI builder reads. */
  controller: RequestHandler;
}>;

const ROUTE_TABLE_OWNER = 'mount';

type MountOptions = {
  container: Container;
  strategies: Strategies;
  root: RouteNode;
};

const fail = (message: string, cause?: unknown): never => {
  throw new RouteDefinitionError(message, cause === undefined ? undefined : { cause });
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const cacheHeaderMiddleware = (access: Access, policy: CachePolicy): RequestHandler => {
  const { [HTTP_HEADERS.VARY]: vary, ...headers } = cacheHeaders(access, policy);
  return (_req, res, next) => {
    res.set(headers);
    // Appends, so a Vary set earlier (CORS sets Origin) survives.
    if (vary) res.vary(vary);
    next();
  };
};

const isNode = (node: unknown): node is RouteNode =>
  typeof node === 'object' &&
  node !== null &&
  ['route', 'group', 'module'].includes((node as { kind?: unknown }).kind as string);

const checkHandlers = (list: unknown, where: string, min = 0): readonly RequestHandler[] => {
  if (!Array.isArray(list)) return fail(`${where} must be an array of middleware`);
  const items = list as unknown[];
  if (items.length < min) fail(`${where} needs at least one handler`);
  items.forEach((fn, i) => {
    if (typeof fn !== 'function') return fail(`${where} #${i + 1} is not a function`);
    // Express decides by arity: four parameters make an error handler, skipped on the normal path.
    if (fn.length === 4)
      fail(
        `${where} #${i + 1} takes 4 parameters, so Express would treat it as an error handler and skip it`,
      );
  });
  return items as RequestHandler[];
};

const collectModules = (node: unknown, found: ModuleDef[]) => {
  if (!isNode(node)) return;
  if (node.kind === 'module') {
    if (found.includes(node)) fail(`Module "${node.name}" is included twice`);
    if (found.some((other) => other.name === node.name))
      fail(`Two modules are named "${node.name}"`);
    found.push(node);
    return;
  }
  if (node.kind === 'group' && Array.isArray(node.children))
    node.children.forEach((child) => collectModules(child, found));
};

const pick = <K extends Key>(container: Container, keys: readonly K[]) => {
  const deps = {} as Pick<Registry, K>;
  for (const key of keys) deps[key] = container.get(key);
  return Object.freeze(deps);
};

const registerModules = (container: Container, modules: readonly ModuleDef[]) => {
  for (const module of modules) {
    if (typeof module.name !== 'string' || !module.name.trim())
      fail('A module needs a non-empty name');
    for (const [key, factory] of Object.entries(module.providers))
      container.provide(key as Key, factory as Factory<Key>, module.name);
  }

  for (const module of modules)
    for (const key of module.needs)
      if (!container.has(key))
        fail(`Module "${module.name}" needs "${key}", but nothing provides it`);
};

/**
 * Builds one Express router from a route tree. Everything is checked here, once: a mistake in the
 * tree stops the boot with a message naming the route, and nothing is checked per request.
 * Routes are registered depth-first, which is the order Express matches them in.
 */
export const mount = ({ container, strategies, root }: MountOptions) => {
  const manifest: RouteManifestEntry[] = [];
  let finished: readonly RouteManifestEntry[] | undefined = undefined;

  // Registered before the modules, so a module providing it too is refused as a duplicate.
  // Routes are built while mounting, so a route function reading it gets a partial list: refused.
  container.provide(
    'routeTable',
    () => ({
      all: () => {
        if (!finished)
          throw new RouteDefinitionError(
            'The route table was read before mounting finished: read it in a request handler',
          );
        return finished;
      },
    }),
    ROUTE_TABLE_OWNER,
  );

  const modules: ModuleDef[] = [];
  collectModules(root, modules);
  registerModules(container, modules);

  const strategyNames = concatenateStrings(Object.keys(strategies), ', ');
  const registered = new Map<RouteMethod, string[]>();

  const resolve = (node: unknown, where: string, insideModule?: string) => {
    if (!isNode(node)) return fail(`${where}: expected a route, a group or a module`);
    if (node.kind !== 'module') return { def: node, module: undefined };
    if (insideModule)
      fail(
        `Module "${node.name}" is inside the routes of module "${insideModule}": list it in a group of the route tree instead`,
      );

    let deps: Pick<Registry, Key>;
    try {
      deps = pick(container, node.needs);
    } catch (err) {
      return fail(`Module "${node.name}": ${messageOf(err)}`, err);
    }

    const def: unknown = node.routes(deps);
    if (!isNode(def) || def.kind === 'module')
      return fail(`Module "${node.name}" must return a route or a group`);
    return { def, module: node.name };
  };

  const mountRoute = (parent: Router, route: RouteDef, base: string, module?: string) => {
    const under = base || '/';
    if (!ROUTE_METHODS.includes(route.method))
      fail(
        `Route "${String(route.path)}" under ${under}: method "${String(route.method)}" must be one of ${concatenateStrings(ROUTE_METHODS, ', ')}`,
      );
    const method = route.method.toUpperCase() as Uppercase<RouteMethod>;

    const problem = pathProblem(route.path);
    if (problem) fail(`${method} "${String(route.path)}" under ${under}: path ${problem}`);

    const path = joinPaths(base, route.path);
    const label = `${method} ${path}`;

    const repeated = duplicateParam(path);
    if (repeated) fail(`${label} uses the param ":${repeated}" twice`);

    const access: unknown = route.access;
    if (
      typeof access !== 'object' ||
      access === null ||
      typeof (access as { strategy?: unknown }).strategy !== 'string'
    )
      fail(`${label} has no access rule: set access to one of ${strategyNames}`);
    const rule = access as Access;
    if (!Object.hasOwn(strategies, rule.strategy))
      fail(
        `${label} uses unknown access strategy "${rule.strategy}": expected one of ${strategyNames}`,
      );

    const strategy = strategies[rule.strategy] as AccessStrategy<StrategyName>;
    const accessProblem = strategy.problem?.(rule);
    if (accessProblem) fail(`${label}: ${accessProblem}`);

    const cacheProblem = cachePolicyProblem(method, rule, route.cache);
    if (cacheProblem) fail(`${label}: ${cacheProblem}`);
    const cache = route.cache ?? (method === 'GET' ? DEFAULT_GET_CACHE_POLICY : undefined);
    const caching = cache ? [cacheHeaderMiddleware(rule, cache)] : [];

    const pre = checkHandlers(route.pre, `${label} pre`);
    const handlers = checkHandlers(route.handlers, `${label} handlers`, 1);

    let guards: readonly RequestHandler[];
    try {
      guards = strategy.handlers(rule, container.get);
    } catch (err) {
      return fail(`${label}: ${messageOf(err)}`, err);
    }
    checkHandlers(guards, `${label} access "${rule.strategy}"`);

    const earlier = registered.get(route.method) ?? [];
    const blocker = earlier.find((other) => shadows(other, path));
    if (blocker !== undefined)
      fail(
        blocker === path
          ? `${label} is defined twice`
          : `${label} can never be reached: ${method} ${blocker} is registered first and matches it`,
      );
    registered.set(route.method, [...earlier, path]);

    manifest.push(
      Object.freeze({
        method,
        path,
        access: Object.freeze({ ...rule }),
        ...(cache && { cache }),
        ...(module && { module }),
        controller: handlers[handlers.length - 1]!,
      }),
    );
    parent[route.method](route.path, ...caching, ...pre, ...guards, ...handlers);
  };

  const mountGroup = (parent: Router, group: GroupDef, base: string, module?: string) => {
    const problem = pathProblem(group.prefix);
    if (problem) fail(`Group "${String(group.prefix)}" under ${base || '/'}: prefix ${problem}`);

    const prefix = joinPaths(base, group.prefix);
    const where = `Group ${prefix}`;
    const use = checkHandlers(group.use, `${where} middleware`);
    if (!Array.isArray(group.children) || group.children.length === 0)
      fail(`${where} has no routes`);

    const router = Router({ mergeParams: true });
    if (use.length) router.use(...use);

    const siblings: string[] = [];
    for (const child of group.children) {
      const resolved = resolve(child, where, module);
      const owner = resolved.module ?? module;

      if (resolved.def.kind === 'group') {
        const childProblem = pathProblem(resolved.def.prefix);
        if (childProblem)
          fail(`Group "${String(resolved.def.prefix)}" under ${prefix}: prefix ${childProblem}`);
        const childPrefix = joinPaths(prefix, resolved.def.prefix);
        if (siblings.some((other) => shadows(other, childPrefix) && shadows(childPrefix, other)))
          fail(`${where} has two groups at ${childPrefix}: merge them into one`);
        siblings.push(childPrefix);
        mountGroup(router, resolved.def, prefix, owner);
      } else {
        mountRoute(router, resolved.def, prefix, owner);
      }
    }

    parent.use(group.prefix, router);
  };

  const router = Router({ mergeParams: true });
  const top = resolve(root, 'Route tree root');
  if (top.def.kind === 'group') mountGroup(router, top.def, '', top.module);
  else mountRoute(router, top.def, '', top.module);

  finished = Object.freeze(manifest);
  return { router, manifest: finished };
};
