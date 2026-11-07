import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express, { type RequestHandler, type Router } from 'express';
import { listen } from '#testing/http';
import { DEFAULT_GET_CACHE_POLICY } from './cachePolicy.ts';
import { createContainer } from './container.ts';
import { ContainerError, RouteDefinitionError } from './errors.ts';
import { mount } from './mount.ts';
import { defineGroup, defineModule, defineRoute, type RouteNode } from './routes.ts';
import { builtInStrategies, type Strategies } from './strategies.ts';
import type { UserRole } from '#constants/user.constant';

declare module './registry.ts' {
  interface Registry {
    mountTestMessage: string;
    mountTestShout: (text: string) => string;
  }
}

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

const serve = async (router: Router) => {
  const app = express();
  app.use(router);
  app.use((_req, res) => {
    res.status(404).json({ fellThrough: true });
  });
  const { server, baseUrl } = await listen(app);
  servers.push(server);
  return baseUrl;
};

const say =
  (text: string): RequestHandler =>
  (_req, res) => {
    res.json({ text });
  };

const record =
  (calls: string[], name: string): RequestHandler =>
  (_req, _res, next) => {
    calls.push(name);
    next();
  };

// Stand-ins for the real auth middleware: the role comes from a header.
const authenticate: RequestHandler = (req, res, next) => {
  const role = req.get('x-test-role');
  if (!role) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  req.user = { id: 'u1', email: 'u1@example.com', role: role as UserRole };
  next();
};
const authorize =
  (roles: readonly UserRole[]): RequestHandler =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };

const withAuth = () => {
  const container = createContainer();
  container.provide('authenticate', () => authenticate);
  container.provide('authorize', () => authorize);
  return container;
};

const build = (root: RouteNode, strategies: Strategies = builtInStrategies) =>
  mount({ container: withAuth(), strategies, root });

const open = { strategy: 'public', reason: 'test' } as const;

const failsWith = (fn: () => unknown, message: RegExp) =>
  assert.throws(
    fn,
    (err: unknown) =>
      (err instanceof RouteDefinitionError || err instanceof ContainerError) &&
      message.test(err.message),
  );

describe('mount: serving', () => {
  it('serves a route at the full path its groups build, in declaration order', async () => {
    const calls: string[] = [];
    const { router } = build(
      defineGroup(
        '/api',
        [
          defineGroup('/v1', [
            defineRoute({
              method: 'get',
              path: '/ping',
              access: { strategy: 'authenticated' },
              pre: [record(calls, 'pre')],
              handlers: [record(calls, 'handler'), say('pong')],
            }),
          ]),
        ],
        { use: [record(calls, 'group')] },
      ),
      {
        ...builtInStrategies,
        authenticated: { handlers: () => [record(calls, 'access')] },
      },
    );
    const url = await serve(router);

    const response = await fetch(`${url}/api/v1/ping`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: 'pong' });
    assert.deepEqual(calls, ['group', 'pre', 'access', 'handler']);
  });

  it('passes params from a group prefix down to the route', async () => {
    const { router } = build(
      defineGroup('/users/:userId', [
        defineRoute({
          method: 'get',
          path: '/posts/:postId',
          access: open,
          handlers: [
            (req, res) => {
              res.json(req.params);
            },
          ],
        }),
      ]),
    );
    const url = await serve(router);

    const response = await fetch(`${url}/users/7/posts/9`);

    assert.deepEqual(await response.json(), { userId: '7', postId: '9' });
  });

  it('lets an unmatched request fall through to whatever comes after', async () => {
    const { router } = build(
      defineGroup('/api', [
        defineRoute({ method: 'get', path: '/a', access: open, handlers: [say('a')] }),
      ]),
    );
    const url = await serve(router);

    assert.deepEqual(await (await fetch(`${url}/api/nope`)).json(), { fellThrough: true });
  });

  it('accepts a single route as the root', async () => {
    const { router } = build(
      defineRoute({ method: 'get', path: '/', access: open, handlers: [say('root')] }),
    );
    const url = await serve(router);

    assert.deepEqual(await (await fetch(url)).json(), { text: 'root' });
  });
});

describe('mount: access', () => {
  const protectedTree = () =>
    build(
      defineGroup('/', [
        defineRoute({ method: 'get', path: '/open', access: open, handlers: [say('open')] }),
        defineRoute({
          method: 'get',
          path: '/me',
          access: { strategy: 'authenticated' },
          handlers: [say('me')],
        }),
        defineRoute({
          method: 'get',
          path: '/admin',
          access: { strategy: 'roles', roles: ['ADMIN'] },
          handlers: [say('admin')],
        }),
      ]),
    );

  it('adds no auth to a public route', async () => {
    const url = await serve(protectedTree().router);

    assert.equal((await fetch(`${url}/open`)).status, 200);
  });

  it('authenticates an `authenticated` route', async () => {
    const url = await serve(protectedTree().router);

    assert.equal((await fetch(`${url}/me`)).status, 401);
    assert.equal((await fetch(`${url}/me`, { headers: { 'x-test-role': 'NORMAL' } })).status, 200);
  });

  it('authenticates, then checks the role, on a `roles` route', async () => {
    const url = await serve(protectedTree().router);

    assert.equal((await fetch(`${url}/admin`)).status, 401);
    assert.equal(
      (await fetch(`${url}/admin`, { headers: { 'x-test-role': 'NORMAL' } })).status,
      403,
    );
    assert.equal(
      (await fetch(`${url}/admin`, { headers: { 'x-test-role': 'ADMIN' } })).status,
      200,
    );
  });

  it('lists every route with its full path, access, module and controller', () => {
    const openController = say('open');
    const goneController = say('gone');
    const { manifest } = build(
      defineGroup('/', [
        defineRoute({ method: 'get', path: '/open', access: open, handlers: [openController] }),
        defineModule({
          name: 'admin',
          needs: [],
          routes: () =>
            defineGroup('/admin', [
              defineRoute({
                method: 'delete',
                path: '/:id',
                access: { strategy: 'roles', roles: ['ADMIN'] },
                handlers: [record([], 'before'), goneController],
              }),
            ]),
        }),
      ]),
    );

    assert.deepEqual(manifest, [
      {
        method: 'GET',
        path: '/open',
        access: open,
        cache: DEFAULT_GET_CACHE_POLICY,
        controller: openController,
      },
      {
        method: 'DELETE',
        path: '/admin/:id',
        access: { strategy: 'roles', roles: ['ADMIN'] },
        module: 'admin',
        controller: goneController,
      },
    ]);
    assert.equal(Object.isFrozen(manifest), true);
  });

  it('refuses a route with no access rule', () => {
    failsWith(
      () => build(defineRoute({ method: 'get', path: '/x', handlers: [say('x')] } as never)),
      /GET \/x has no access rule/,
    );
  });

  it('refuses an unknown strategy, including names inherited from Object', () => {
    for (const strategy of ['nobody', 'toString'])
      failsWith(
        () =>
          build(
            defineRoute({
              method: 'get',
              path: '/x',
              access: { strategy } as never,
              handlers: [say('x')],
            }),
          ),
        new RegExp(`unknown access strategy "${strategy}"`),
      );
  });

  it('refuses a public route without a reason', () => {
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'get',
            path: '/x',
            access: { strategy: 'public', reason: '  ' },
            handlers: [say('x')],
          }),
        ),
      /GET \/x: a public route needs a reason/,
    );
  });

  it('refuses a roles route with no roles or an unknown role', () => {
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'get',
            path: '/x',
            access: { strategy: 'roles', roles: [] as never },
            handlers: [say('x')],
          }),
        ),
      /at least one role/,
    );
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'get',
            path: '/x',
            access: { strategy: 'roles', roles: ['ROOT' as UserRole] },
            handlers: [say('x')],
          }),
        ),
      /unknown role "ROOT"/,
    );
  });

  it('names the route when its access strategy needs something nobody provides', () => {
    failsWith(
      () =>
        mount({
          container: createContainer(),
          strategies: builtInStrategies,
          root: defineRoute({
            method: 'get',
            path: '/me',
            access: { strategy: 'authenticated' },
            handlers: [say('me')],
          }),
        }),
      /GET \/me: No provider for "authenticate"/,
    );
  });
});

describe('mount: caching', () => {
  it('gives a GET without a rule the default, and lists it in the manifest', async () => {
    const { router, manifest } = build(
      defineRoute({ method: 'get', path: '/x', access: open, handlers: [say('x')] }),
    );
    const url = await serve(router);

    assert.equal((await fetch(`${url}/x`)).headers.get('Cache-Control'), 'private, no-cache');
    assert.deepEqual(manifest[0]?.cache, DEFAULT_GET_CACHE_POLICY);
  });

  it('sets no Cache-Control on a non-GET without a rule', async () => {
    const { router, manifest } = build(
      defineRoute({ method: 'post', path: '/x', access: open, handlers: [say('x')] }),
    );
    const url = await serve(router);

    assert.equal((await fetch(`${url}/x`, { method: 'POST' })).headers.get('Cache-Control'), null);
    assert.equal('cache' in manifest[0]!, false);
  });

  it('sets the declared rule', async () => {
    const { router, manifest } = build(
      defineGroup('/', [
        defineRoute({
          method: 'get',
          path: '/fresh',
          access: open,
          cache: { mode: 'fresh', maxAgeS: 60 },
          handlers: [say('fresh')],
        }),
        defineRoute({
          method: 'post',
          path: '/token',
          access: open,
          cache: { mode: 'no-store' },
          handlers: [say('token')],
        }),
      ]),
    );
    const url = await serve(router);

    assert.equal((await fetch(`${url}/fresh`)).headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(
      (await fetch(`${url}/token`, { method: 'POST' })).headers.get('Cache-Control'),
      'no-store',
    );
    assert.deepEqual(manifest[0]?.cache, { mode: 'fresh', maxAgeS: 60 });
  });

  it('sets the headers before pre and the access check, so a rejected caller gets them too', async () => {
    const seenInPre: (string | undefined)[] = [];
    const { router } = build(
      defineRoute({
        method: 'get',
        path: '/me',
        access: { strategy: 'authenticated' },
        pre: [
          (_req, res, next) => {
            seenInPre.push(res.get('Cache-Control'));
            next();
          },
        ],
        handlers: [say('me')],
      }),
    );
    const url = await serve(router);

    const response = await fetch(`${url}/me`);

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-cache');
    assert.equal(response.headers.get('Vary'), 'Authorization');
    assert.deepEqual(seenInPre, ['private, no-cache']);
  });

  it('adds to a Vary header set earlier instead of replacing it', async () => {
    const router = express.Router();
    router.use((_req, res, next) => {
      res.vary('Origin');
      next();
    });
    router.use(
      build(
        defineRoute({
          method: 'get',
          path: '/me',
          access: { strategy: 'authenticated' },
          handlers: [say('me')],
        }),
      ).router,
    );
    const url = await serve(router);

    const response = await fetch(`${url}/me`, { headers: { 'x-test-role': 'NORMAL' } });

    assert.equal(response.headers.get('Vary'), 'Origin, Authorization');
  });

  it('refuses shared caches on a route that needs credentials, naming the route', () => {
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'get',
            path: '/me',
            access: { strategy: 'authenticated' },
            cache: { mode: 'fresh', maxAgeS: 60, shared: true },
            handlers: [say('me')],
          }),
        ),
      /GET \/me: a route that needs credentials cannot be stored by shared caches \(shared: true\)/,
    );
  });

  it('refuses a rule other than no-store on a non-GET, naming the route', () => {
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'post',
            path: '/x',
            access: open,
            cache: { mode: 'revalidate' },
            handlers: [say('x')],
          }),
        ),
      /POST \/x: .*only no-store/,
    );
  });
});

describe('mount: route definitions', () => {
  it('refuses an invalid path, naming where it is', () => {
    failsWith(
      () =>
        build(
          defineGroup('/api', [
            defineRoute({
              method: 'get',
              path: '/files/*rest',
              access: open,
              handlers: [say('x')],
            }),
          ]),
        ),
      /GET "\/files\/\*rest" under \/api: path segment "\*rest" is not allowed/,
    );
  });

  it('refuses an unknown method', () => {
    failsWith(
      () =>
        build(
          defineRoute({ method: 'trace' as never, path: '/x', access: open, handlers: [say('x')] }),
        ),
      /method "trace" must be one of get, post, put, patch, delete/,
    );
  });

  it('refuses the same route twice', () => {
    failsWith(
      () =>
        build(
          defineGroup('/', [
            defineRoute({ method: 'get', path: '/x', access: open, handlers: [say('1')] }),
            defineRoute({ method: 'get', path: '/x', access: open, handlers: [say('2')] }),
          ]),
        ),
      /GET \/x is defined twice/,
    );
  });

  it('allows the same path under another method', () => {
    assert.doesNotThrow(() =>
      build(
        defineGroup('/', [
          defineRoute({ method: 'get', path: '/x', access: open, handlers: [say('1')] }),
          defineRoute({ method: 'post', path: '/x', access: open, handlers: [say('2')] }),
        ]),
      ),
    );
  });

  it('refuses a route that an earlier one in another group always catches', () => {
    failsWith(
      () =>
        build(
          defineGroup('/', [
            defineGroup('/users/:id', [
              defineRoute({ method: 'get', path: '/', access: open, handlers: [say('user')] }),
            ]),
            defineGroup('/users', [
              defineRoute({ method: 'get', path: '/me', access: open, handlers: [say('me')] }),
            ]),
          ]),
        ),
      /GET \/users\/me can never be reached: GET \/users\/:id is registered first/,
    );
  });

  it('allows a static route registered before a param route of the same shape', () => {
    assert.doesNotThrow(() =>
      build(
        defineGroup('/users', [
          defineRoute({ method: 'get', path: '/me', access: open, handlers: [say('me')] }),
          defineRoute({ method: 'get', path: '/:id', access: open, handlers: [say('user')] }),
        ]),
      ),
    );
  });

  it('refuses a param name used twice across a prefix and a path', () => {
    failsWith(
      () =>
        build(
          defineGroup('/users/:id', [
            defineRoute({ method: 'get', path: '/posts/:id', access: open, handlers: [say('x')] }),
          ]),
        ),
      /GET \/users\/:id\/posts\/:id uses the param ":id" twice/,
    );
  });

  it('refuses a handler that is not a function, naming its position', () => {
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'get',
            path: '/x',
            access: open,
            handlers: [say('x'), undefined as never],
          }),
        ),
      /GET \/x handlers #2 is not a function/,
    );
  });

  it('refuses an error handler in a route, which Express would silently skip', () => {
    const errorHandler = ((_err: unknown, _req: unknown, _res: unknown, next: () => void) =>
      next()) as unknown as RequestHandler;
    failsWith(
      () =>
        build(
          defineRoute({
            method: 'get',
            path: '/x',
            access: open,
            pre: [errorHandler],
            handlers: [say('x')],
          }),
        ),
      /GET \/x pre #1 takes 4 parameters/,
    );
  });

  it('refuses a route without handlers', () => {
    failsWith(
      () => build(defineRoute({ method: 'get', path: '/x', access: open, handlers: [] as never })),
      /GET \/x handlers needs at least one handler/,
    );
  });

  it('refuses an empty group, whose middleware would run with no route to serve', () => {
    failsWith(() => build(defineGroup('/api', [])), /Group \/api has no routes/);
  });

  it('refuses two sibling groups at the same prefix', () => {
    failsWith(
      () =>
        build(
          defineGroup('/', [
            defineGroup('/api', [
              defineRoute({ method: 'get', path: '/a', access: open, handlers: [say('a')] }),
            ]),
            defineGroup('/API', [
              defineRoute({ method: 'get', path: '/b', access: open, handlers: [say('b')] }),
            ]),
          ]),
        ),
      /Group \/ has two groups at \/API/,
    );
  });
});

describe('mount: modules', () => {
  const greeting = defineModule({
    name: 'greeting',
    providers: {
      mountTestMessage: () => 'hello',
      mountTestShout: () => (text: string) => text.toUpperCase(),
    },
    needs: ['mountTestMessage', 'mountTestShout'],
    routes: ({ mountTestMessage, mountTestShout }) =>
      defineGroup('/greeting', [
        defineRoute({
          method: 'get',
          path: '/',
          access: open,
          handlers: [say(mountTestShout(mountTestMessage))],
        }),
      ]),
  });

  it('provides the route table, readable once mounting is done', () => {
    let table: { all: () => readonly unknown[] } | undefined;
    const { manifest } = build(
      defineModule({
        name: 'docs',
        needs: ['routeTable'],
        routes: ({ routeTable }) => {
          table = routeTable;
          assert.throws(() => routeTable.all(), /before mounting finished/);
          return defineRoute({ method: 'get', path: '/docs', access: open, handlers: [say('d')] });
        },
      }),
    );

    assert.equal(table?.all(), manifest);
  });

  it('refuses a module that provides the route table itself', () => {
    failsWith(
      () =>
        build(
          defineModule({
            name: 'impostor',
            providers: { routeTable: () => ({ all: () => [] }) },
            needs: [],
            routes: () =>
              defineRoute({ method: 'get', path: '/', access: open, handlers: [say('x')] }),
          }),
        ),
      /routeTable/,
    );
  });

  it('registers its providers and hands its routes what they need', async () => {
    const url = await serve(build(greeting).router);

    assert.deepEqual(await (await fetch(`${url}/greeting`)).json(), { text: 'HELLO' });
  });

  it('hands its routes only the keys it declared', () => {
    let seen: string[] = [];
    build(
      defineModule({
        name: 'narrow',
        providers: { mountTestMessage: () => 'hello', mountTestShout: () => (t: string) => t },
        needs: ['mountTestMessage'],
        routes: (deps) => {
          seen = Object.keys(deps);
          return defineRoute({ method: 'get', path: '/', access: open, handlers: [say('x')] });
        },
      }),
    );

    assert.deepEqual(seen, ['mountTestMessage']);
  });

  it('lets a module use what another module provides, whatever their order in the tree', async () => {
    const consumer = defineModule({
      name: 'consumer',
      needs: ['mountTestMessage'],
      routes: ({ mountTestMessage }) =>
        defineRoute({
          method: 'get',
          path: '/consumer',
          access: open,
          handlers: [say(mountTestMessage)],
        }),
    });
    const owner = defineModule({
      name: 'owner',
      providers: { mountTestMessage: () => 'shared' },
      needs: [],
      routes: () =>
        defineRoute({ method: 'get', path: '/owner', access: open, handlers: [say('owner')] }),
    });
    const url = await serve(build(defineGroup('/', [consumer, owner])).router);

    assert.deepEqual(await (await fetch(`${url}/consumer`)).json(), { text: 'shared' });
  });

  it('names the module and the key when nothing provides what it needs', () => {
    failsWith(
      () =>
        build(
          defineModule({
            name: 'lonely',
            needs: ['mountTestMessage'],
            routes: () =>
              defineRoute({ method: 'get', path: '/', access: open, handlers: [say('x')] }),
          }),
        ),
      /Module "lonely" needs "mountTestMessage", but nothing provides it/,
    );
  });

  it('names the module when one of its providers fails', () => {
    failsWith(
      () =>
        build(
          defineModule({
            name: 'broken',
            providers: {
              mountTestMessage: () => {
                throw new Error('config missing');
              },
            },
            needs: ['mountTestMessage'],
            routes: () =>
              defineRoute({ method: 'get', path: '/', access: open, handlers: [say('x')] }),
          }),
        ),
      /Module "broken": config missing/,
    );
  });

  it('refuses the same module twice', () => {
    failsWith(
      () => build(defineGroup('/', [defineGroup('/a', [greeting]), defineGroup('/b', [greeting])])),
      /Module "greeting" is included twice/,
    );
  });

  it('refuses two modules with the same name', () => {
    const twin = defineModule({
      name: 'greeting',
      needs: [],
      routes: () =>
        defineRoute({ method: 'get', path: '/twin', access: open, handlers: [say('x')] }),
    });
    failsWith(() => build(defineGroup('/', [greeting, twin])), /Two modules are named "greeting"/);
  });

  it('refuses a module inside the routes of another module', () => {
    const inner = defineModule({
      name: 'inner',
      needs: [],
      routes: () => defineRoute({ method: 'get', path: '/', access: open, handlers: [say('x')] }),
    });
    failsWith(
      () =>
        build(
          defineModule({
            name: 'outer',
            needs: [],
            routes: () => defineGroup('/outer', [inner]),
          }),
        ),
      /Module "inner" is inside the routes of module "outer"/,
    );
  });

  it('refuses a module whose routes are not a route or a group', () => {
    failsWith(
      () => build(defineModule({ name: 'empty', needs: [], routes: () => undefined as never })),
      /Module "empty" must return a route or a group/,
    );
  });
});
