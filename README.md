# express-layered-starter

A Node.js + Express starter built on a clean **layered architecture** (routes → controllers → services → repository). It ships the parts every backend needs and nobody enjoys rebuilding — request-scoped logging, an error hierarchy with framework converters, request validation, uniform API responses, and pagination — so a new project starts at the interesting part.

`main` is **database-agnostic**. Each database integration lives on its own branch.

## What's already built

| Capability | Where |
|------------|-------|
| Layered architecture with enforced dependency direction | [`src/README.md`](src/README.md) |
| Route tree with a typed container: feature modules, a required access rule on every route, ordered middleware, boot-time checks for unreachable routes and wiring mistakes | [`src/http/`](src/http/) · [`src/modules/`](src/modules/) |
| Request IDs, propagated without passing `req` around | [`contexts/`](src/contexts/) · [`requestId.middleware.ts`](src/middlewares/requestId.middleware.ts) |
| Structured JSON logging with secret redaction | [`lib/logger/`](src/lib/logger/) · [`logger.config.ts`](src/config/logger.config.ts) |
| HTTP access logs with duration + slow-request warnings | [`httpLogger.middleware.ts`](src/middlewares/httpLogger.middleware.ts) |
| Error class hierarchy + converters + central handler | [`errors/`](src/errors/) · [`error.middleware.ts`](src/middlewares/error.middleware.ts) |
| Request validation (body, query, params, response) with Zod | [`lib/http/route.lib.ts`](src/lib/http/route.lib.ts) · [`zod.converter.ts`](src/errors/converter/zod.converter.ts) |
| Uniform success/error response envelope | [`apiResponse.util.ts`](src/utils/apiResponse.util.ts) |
| Validated pagination (parse, clamp, build meta) | [`paginator.util.ts`](src/utils/paginator.util.ts) |
| Graceful shutdown + process-level crash handling | [`lib/lifecycle/`](src/lib/lifecycle/) · [`server.ts`](src/server.ts) |
| Health checks (liveness + readiness) | [`routes/health/`](src/routes/health/) · [`controllers/health/`](src/controllers/health/) |
| Rate limiting: per-route policies, in-memory or Redis, `RateLimit-*` headers, explicit store-failure modes | [`src/rateLimiter/`](src/rateLimiter/) |
| Idempotency: `Idempotency-Key` replay of a completed `POST`/`PATCH`, conflict and reuse detection, in-memory or Redis | [`src/idempotency/`](src/idempotency/) |
| CORS, off by default; origins, credentials, methods and headers validated at boot | [`cors.middleware.ts`](src/middlewares/cors.middleware.ts) · [`cors.config.ts`](src/config/cors.config.ts) |
| Auth: login, short-lived JWT access tokens, rotating refresh tokens with reuse detection, logout | [Authentication](#authentication) · [`auth.service.ts`](src/services/auth.service.ts) · [`authenticate.middleware.ts`](src/middlewares/authenticate.middleware.ts) |
| OpenAPI 3.1 document at `GET /api/docs/openapi.json`, generated from the mounted routes and their Zod schemas | [OpenAPI](#openapi) · [`openapi.lib.ts`](src/lib/http/openapi.lib.ts) |
| Docker image (multi-stage, non-root, healthcheck) and a Compose file with Redis | [Docker](#docker) · [`Dockerfile`](Dockerfile) · [`compose.yaml`](compose.yaml) |
| A working end-to-end endpoint to copy: `POST /api/v1/user/register` | [`user.controller.ts`](src/controllers/api/v1/user.controller.ts) · [`user.service.ts`](src/services/user.service.ts) |
| Security headers, static serving, proxy-aware client IPs | [`app.ts`](src/app.ts) (`helmet`, `express.static`, `trust proxy`) |
| Subpath imports (`#services/*`, `#errors`, …) | `package.json` → `imports` |

## Tech stack

| Tool | Purpose |
|------|---------|
| [Express 5](https://expressjs.com/) | Web framework / HTTP server |
| [pino](https://getpino.io/) | Structured JSON logging (`pino-pretty` in dev) |
| [Zod 4](https://zod.dev/) | Request and response validation through [`route()`](src/lib/http/route.lib.ts) |
| [EJS](https://ejs.co/) | Server-side rendered views |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | Access tokens (HS256), wrapped in [`lib/auth/accessToken.ts`](src/lib/auth/accessToken.ts) |
| [helmet](https://helmetjs.github.io/) | Security headers, mounted on every response |
| [TypeScript 6](https://www.typescriptlang.org/) | Strict type-checking; `tsc` compiles `src/` → `dist/` |
| [typescript-eslint](https://typescript-eslint.io/) | Type-aware lint rules (floating promises, unsafe `any`, …) |
| ES Modules | `"type": "module"` — `import` / `export` |
| `node --env-file` | Native `.env` loading, no `dotenv` |
| Node type stripping | `pnpm dev` runs `src/*.ts` directly — no `tsx`/`ts-node` |
| husky + lint-staged | Pre-commit lint/format, pre-push typecheck |

## Getting started

### Prerequisites

- **Node.js ≥26** — enforced via `engines` + `.npmrc` (`engine-strict`). Use the pinned version with `nvm use` (reads [`.nvmrc`](.nvmrc)).
- **pnpm** is the only supported package manager. Install it with Corepack, which picks the version pinned in `packageManager`: `npm install --global corepack && corepack enable pnpm` (Node 25 and later no longer bundle Corepack). A `preinstall` guard rejects `npm` and `yarn`.

### Install

```bash
pnpm install
```

### Environment

Copy [`.env.example`](.env.example) to `.env` in the project root — `.env` is gitignored, never commit it:

```bash
cp .env.example .env
```

The environment is validated at boot by the Zod schema in [`src/constants/env/schema.ts`](src/constants/env/schema.ts). A missing or malformed value stops the app with a message naming the variable (the value itself is never printed).

- **`NODE_ENV` is required** (`development` | `test` | `production`). There is no default on purpose: a deploy that forgets it must fail, not silently run as `development` and send stack traces to clients.
- **`JWT_SECRET` is required in production** (at least 32 characters). Elsewhere a missing one is generated per process, so `pnpm dev` works out of the box, but every token stops working when the process restarts. Set it in `.env` to stay signed in across restarts.
- Every other variable has a default, and an empty value (`KEY=`) counts as unset.

`SHUTDOWN_DELAY_MS` must be smaller than `SHUTDOWN_TIMEOUT_MS`, or the app refuses to start. Set it to `0` locally so Ctrl+C exits at once; see [`src/lib/README.md`](src/lib/README.md#lifecycle) for tuning per platform.

The HTTP timeouts (`LB_IDLE_TIMEOUT_MS`, `HTTP_KEEP_ALIVE_TIMEOUT_MS`, `HTTP_HEADERS_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `REQUEST_HANDLER_TIMEOUT_MS`) must keep a fixed order, which the schema checks at boot: handler < load balancer idle < keep-alive < headers (by a 1s margin) <= request. The order is what stops a load balancer from reusing a connection Node has just closed. Each variable's rule is in [`.env.example`](.env.example).

With more than one instance, set `AUTH_STORE=redis` too, or a refresh token only works on the instance that issued it. See [Authentication](#authentication).

Rate limiting works with no setup: it uses an in-memory store, so limits are per instance. To share limits across replicas set `RATE_LIMIT_STORE=redis` and `REDIS_URL`; `RATE_LIMIT_ON_STORE_ERROR` then decides what happens while Redis is down (`local`, `allow` or `deny`). Startup waits at most `REDIS_CONNECT_TIMEOUT_MS` for Redis, then continues and reconnects in the background. Details, headers and failure modes are in [`src/rateLimiter/README.md`](src/rateLimiter/README.md).

`TRUST_PROXY` sets Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html), which decides how `req.ip` is read behind a reverse proxy. Its meaning depends on the type: a **number** trusts that many hops (`1` for a single nginx/load balancer), `true`/`false` trust all/none, and a string like `loopback` or a subnet trusts specific addresses. Leave it empty locally (no proxy); set it to the real hop count in production, or a client can forge their IP.

### Run

```bash
pnpm dev
```

Loads `.env` and restarts on file changes. The server listens on `PORT` (default `8000`).

Node strips the types and runs `src/*.ts` as-is, so **dev never type-checks**. Your editor shows errors live; for a terminal view run `pnpm typecheck:watch` alongside `pnpm dev`.

### Build for production

```bash
pnpm build   # type-check + compile src/ -> dist/, and copy the EJS templates (no output at all if any type error)
pnpm start   # node dist/server.js
```

`dist/` is self-contained next to `public/`, `node_modules/` and `package.json` (Node resolves the `#imports` map from it): it does not read `src/`. CI proves it by deleting `src/` before the smoke test.

## Docker

```bash
JWT_SECRET=<at least 32 characters> docker compose up --build --wait
```

[`compose.yaml`](compose.yaml) runs the production image next to Redis, with `AUTH_STORE`, `RATE_LIMIT_STORE` and `IDEMPOTENCY_STORE` all on Redis, so it behaves like a multi-instance deploy: sessions, limits and idempotency keys survive an app restart. The app is on `http://localhost:8000` (`APP_PORT` changes the host port). `--wait` returns once both containers are healthy. `docker compose down` stops it; add `--volumes` to drop Redis's data as well. Use `pnpm dev` for day-to-day work.

Compose sets the container's variables itself and does not load `.env` into it, so a local `NODE_ENV=development` never reaches the image. It does read `JWT_SECRET` and `APP_PORT` from the shell or `.env`, and refuses to start without `JWT_SECRET`. Add any other variable from [`.env.example`](.env.example) under `environment:`.

The [`Dockerfile`](Dockerfile) has three build stages and ships only the last:

| Stage | Does | In the final image |
|-------|------|:---:|
| `build` | installs every dependency, runs `pnpm build` | `dist/` only |
| `prod-deps` | installs production dependencies only | `node_modules/` only |
| `runtime` | `node:26-alpine`, `NODE_ENV=production`, `package.json`, `public/` | yes |

**Behaviors worth knowing**

- **No pnpm, compiler, `src/` or dev dependency in the image.** pnpm comes from Corepack at the `packageManager` version, in the build stages only. Installs run with `--frozen-lockfile`, so a lockfile out of date with `package.json` fails the build, and `--ignore-scripts`, since the `preinstall` and husky hooks are for developer machines.
- **Runs as the `node` user**, not root. The app's files are owned by root, so the process can read its code but not change it.
- **Node is PID 1**, started directly rather than through `pnpm start`, so `SIGTERM` reaches [`server.ts`](src/server.ts) and the drain in [`lib/lifecycle/`](src/lib/lifecycle/) runs. `stop_grace_period` (15s) is longer than `SHUTDOWN_TIMEOUT_MS` (8s by default); raise both together. Under Kubernetes the matching setting is `terminationGracePeriodSeconds`.
- **The `HEALTHCHECK` probes `/health/live`**, with Node's `fetch` (Alpine has no curl). Liveness and not readiness, because Docker and Swarm restart an unhealthy container, and a restart cannot fix a Redis outage. Point the load balancer, or the Kubernetes readiness probe, at `/health/ready`.
- **Secrets never enter the build.** [`.dockerignore`](.dockerignore) excludes `.env*`, along with `node_modules`, `dist` and `.git`. Pass `JWT_SECRET` and `REDIS_URL` at run time.
- **Redis keeps an append-only file** on the `redis-data` volume, so revoked sessions stay revoked across a Redis restart.

CI builds the image, starts the stack with `--wait`, and checks readiness, the OpenAPI document, a login and refresh stored in Redis, and that the process is not root ([`ci.yml`](.github/workflows/ci.yml), job `docker`).

## TypeScript & build

Type errors are caught at four gates, each stricter than the last:

| Gate | Runs | Blocks |
|------|------|--------|
| Editor | as you type (`tsconfig.json`) | nothing — just red squiggles |
| `pre-commit` hook | `lint-staged`: ESLint `--fix` + Prettier on staged files | the commit |
| `pre-push` hook | `pnpm typecheck` + `pnpm lint` on the whole project | the push |
| CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) | typecheck → lint → format → test → build → boot `dist/` and hit `/health/live` | the merge |

**Two tsconfigs, one set of rules.** [`tsconfig.json`](tsconfig.json) holds every compiler rule and never emits — the editor, `pnpm typecheck` and typed ESLint all read it. [`tsconfig.build.json`](tsconfig.build.json) extends it and only adds output settings: `src/` → `dist/`, source maps, and `noEmitOnError` so a type error produces no build at all.

**How imports resolve in dev and prod.** Relative imports are written as `./file.ts`; `tsc` rewrites them to `./file.js` in `dist/` (`rewriteRelativeImportExtensions`). `#alias` imports are written without an extension, and [`package.json` `"imports"`](package.json) maps each one twice:

```jsonc
"#services/*": {
  "app-source": "./src/services/*.ts", // pnpm dev (node --conditions=app-source) and tsc
  "default": "./dist/services/*.js"    // pnpm start
}
```

`tsc` and ESLint resolve the `app-source` condition too (`customConditions` in `tsconfig.json`), so types always come from the real source file.

**Rules the setup enforces, and why:**

- `strict` + `noUncheckedIndexedAccess` — `arr[i]` and `record[key]` are `T | undefined` until you check them.
- `erasableSyntaxOnly` — no `enum`, `namespace` or constructor parameter properties, because Node can only *strip* types, not transform code. Use `as const` objects/arrays for enums (see [`user.constant.ts`](src/constants/user.constant.ts)).
- `verbatimModuleSyntax` — type-only imports must be written `import type { … }`.
- Thrown values are `unknown` — narrow with `instanceof` / `typeof` before reading fields (see [`http.converter.ts`](src/errors/converter/http.converter.ts)).
- Project-wide additions to Express types (`req.id`, `res.locals.errorCode`) live in [`src/types/express.d.ts`](src/types/express.d.ts).

**TypeScript version.** Pinned to `~6.0` on purpose: typescript-eslint (`<6.1`) does not support the Go-based TypeScript 7 yet. Move to 7 once typescript-eslint does.

## Branches

| Branch | Contains |
|--------|----------|
| `main` | The database-agnostic base. `repository/` and `models/` are empty scaffolding. |
| `mongodb` | Mongoose: user schema and the Mongoose error converter. |

Start from `main` for a new project, then merge in the branch for your database — or write your own repository layer against whatever you like. Nothing above `repository/` knows how data is stored.

## Project structure

```
express-layered-starter/
├── .env                 # env config (gitignored)
├── package.json         # deps + subpath import aliases
├── tsconfig.json        # type-check rules (editor, pnpm typecheck, ESLint)
├── tsconfig.build.json  # production build: src/ -> dist/
├── Dockerfile           # multi-stage production image
├── compose.yaml         # the image plus Redis, every store on Redis
├── dist/                # compiled output (gitignored)
└── src/
    ├── app.ts           # builds the Express app: container, route tree, middleware; no listen()
    ├── server.ts        # entry point — starts the HTTP server
    ├── config/          # tunable settings, derived from env
    ├── constants/       # fixed values that never change
    ├── contexts/        # AsyncLocalStorage — request-scoped state
    ├── controllers/     # HTTP layer (req/res), calls services
    ├── errors/          # error classes + framework error converters
    ├── http/            # container, route definitions, access strategies, mount()
    ├── idempotency/     # Idempotency-Key replay (wired in server.ts and app.ts)
    ├── lib/             # wrappers around external systems (logger, process lifecycle, route())
    ├── middlewares/     # cross-cutting request concerns
    ├── models/          # data shapes / DB schemas
    ├── modules/         # one per feature: wires repository → service → controller → routes
    ├── rateLimiter/     # request throttling: policies, store, headers (wired in server.ts and app.ts)
    ├── repository/      # database access only
    ├── routes/          # URL + access rule → middleware and controller
    ├── types/           # project-wide type augmentations (*.d.ts)
    ├── services/        # business logic, rules, orchestration
    ├── testing/         # helpers for *.test.ts only (#testing/*); not built, lint-blocked elsewhere
    ├── utils/           # small pure helpers
    └── views/           # EJS templates
```

> Every folder has its own `README.md` explaining exactly what belongs in it. See [`src/README.md`](src/README.md) for how the layers connect.

## Architecture in one picture

```
HTTP request
   ↓
securityHeaders  →  requestId  →  httpLogger  →  (cors)   (cross-cutting middleware)
   ↓
static files,  /health                   (answered here: never rate limited, never timed out)
   ↓
rateLimiter  →  requestTimeout           (everything below is limited and time-boxed)
   ↓
routes/        which URL → pre → access (authenticate, authorize) → handlers → controller
   ↓
controllers/   read req, call service, send res          (HTTP only)
   ↓
services/      validate, apply rules, orchestrate steps  (the brain)
   ↓
repository/    run the database query                    (the hands)
   ↓
models/ → Database

   ↓ anything thrown ↓
notFound  →  errorHandler                (normalize, log, respond)

   (config / constants / utils / errors are available to every layer)
```

**The golden rule:** each layer only talks to the one directly below it.

- Controllers never query the database.
- Services never touch `req` / `res`.
- Repositories never contain business rules.

## Request IDs

Every request gets an ID — reused from an inbound `X-Request-Id` header when it is well-formed, generated otherwise. It is set on `req.id`, echoed back as a response header, and stored in `AsyncLocalStorage`, so **every log line from any file carries it without threading `req` through your call stack**:

```js
import { getLogger } from '#lib/logger/index'
const logger = getLogger('user.service')

logger.info({ userId }, 'user created')
// → {"level":"info","requestId":"3f2b…","module":"user.service","userId":"…"}
```

## Error handling

Throw a typed error from anywhere; the middleware does the rest.

```js
import { NotFoundError } from '#errors'

const getUser = async (id) => {
    const user = await userRepository.findById(id)
    if (!user) throw new NotFoundError('User not found')
    return user
}
```

The handler normalizes anything thrown — including framework errors from JWT or your database driver, via [`errors/converter/`](src/errors/converter/) — then logs it and responds in the right format: JSON for `/api` routes, a rendered `error` view otherwise. Stack traces are included only when `NODE_ENV=development` is set explicitly; an unset `NODE_ENV` never exposes them.

## Request validation

Wrap a controller in [`route()`](src/lib/http/route.lib.ts) and give it Zod schemas. The handler receives parsed, typed input, and whatever it returns is sent as `data` in the same envelope `apiResponse` uses (see [Responses](#responses)):

```js
import { z } from 'zod'
import { route } from '#lib/http/route.lib'

export const createUser = route(
    { body: z.object({ email: z.email(), name: z.string().min(1) }) },
    ({ body }) => userService.createUser(body),   // body is already validated and typed
    { status: 201 },
)
```

Bad input never reaches the handler. Every failing field in `body`, `query` and `params` comes back in one `400`:

```json
{
  "success": false,
  "code": "BAD_REQUEST",
  "message": "Validation Failed",
  "requestId": "3f2b…",
  "details": [
    { "path": "body.email", "message": "Invalid email address" },
    { "path": "query.page", "message": "Too small: expected number to be >=1" }
  ]
}
```

Only invalid input produces a `400`. Anything that goes wrong after that, including a Zod error thrown inside the handler or a return value that fails its `response` schema, is a server bug and returns a generic `500`. The full rules are in [`src/lib/README.md`](src/lib/README.md#http).

## Responses

```js
import { apiResponse } from '#utils/apiResponse.util'

apiResponse.ok(res, user)
apiResponse.created(res, user, { message: 'User registered' })
apiResponse.pagination(res, items, { total, page, pageSize })
```

Every success response carries the same envelope, whether a handler calls `apiResponse` or returns a value from `route()`:

```json
{ "success": true, "message": "Success", "data": {}, "requestId": "3f2b…" }
```

## Authentication

Two tokens, because one token cannot be both cheap to check and revocable:

| | Access token | Refresh token |
|---|---|---|
| Form | JWT, HS256, signed with `JWT_SECRET` | opaque `<id>.<secret>`; only a sha256 of the secret is stored |
| Lifetime | `JWT_ACCESS_TTL_S`, 15 minutes | `JWT_REFRESH_TTL_S`, 30 days, renewed on each refresh |
| Sent as | `Authorization: Bearer <token>` | JSON body of `/auth/refresh` and `/auth/logout` |
| Checked by | signature and claims only, no store lookup | the refresh token store |
| Revocable | no: it simply expires | yes |

| Endpoint | Access | Body | Answer |
|----------|--------|------|--------|
| `POST /api/v1/user/register` | public | `fullName`, `email`, `password` | `201`, the new user (role `NORMAL`) |
| `POST /api/v1/auth/login` | public | `email`, `password` | `200` `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn }` |
| `POST /api/v1/auth/refresh` | public: the body is the credential | `refreshToken` | `200`, a new pair; the old refresh token stops working |
| `POST /api/v1/auth/logout` | public: the body is the credential | `refreshToken` | `204`, always |
| `GET /api/v1/user/me` | `authenticated` | — | `200` `{ id, fullName, email, role }` |

How a client uses it: log in, send the access token on every call, and on a `401` with `TOKEN_EXPIRED` call refresh once and retry. When refresh fails, send the user to log in.

**Behaviors worth knowing**

- **Refresh tokens rotate, and a reused one revokes the login.** Each refresh token works once. If an old one comes back, two parties hold it (a stolen copy, or a client that lost the response), and the server cannot tell which is the owner. So every token from that login stops working, a warning is logged, and both parties have to log in again. Two simultaneous refreshes with the same token count as reuse too, so a client should send one refresh at a time.
- **Each login is its own family.** Logging out on the phone leaves the laptop signed in.
- **Refresh reads the user again**, so a changed role or a deleted account takes effect at the next refresh, within `JWT_ACCESS_TTL_S`. Until then an issued access token stays valid; that window is the price of not checking a store on every request.
- **A wrong password and an unknown email answer the same** (`401 INVALID_CREDENTIALS`), and both cost one scrypt hash, so neither the message nor the timing tells an attacker which emails are registered.
- **Logout always answers `204`**, whether the token was valid, already revoked, or garbage. A token with a known id but the wrong secret changes nothing, so nobody can log another person out by guessing an id.
- **Verification is pinned**: algorithm HS256, issuer and audience both `SERVICE_NAME`, 5 seconds of clock tolerance. A token signed with `alg: none`, another HMAC algorithm, another secret or for another service is refused. Change `SERVICE_NAME` and every issued token is refused.
- **A `401` says why** in `WWW-Authenticate` ([RFC 6750](https://www.rfc-editor.org/rfc/rfc6750)): `Bearer` when no token was sent, `Bearer error="invalid_token"` when one was refused. The body's `code` is `UNAUTHORIZED`, `TOKEN_INVALID` or `TOKEN_EXPIRED`.
- **Token responses are never cached** (`Cache-Control: no-store`), and they skip idempotency on purpose: a replay would hand the same tokens out again, and the idempotency store would keep live credentials.
- **Only failures count against the `auth` rate limit** on login, refresh and logout (`refundOnSuccess`). A client refreshing every 15 minutes never hits it; a password-guessing loop does.
- **`AUTH_STORE` picks where refresh tokens live.** `memory` (the default) is per instance and lost on restart, and production logs a warning about it. `redis` shares them across replicas: a token issued by one instance can be refreshed, reused-detected or logged out on any other. Each token is a Redis hash that expires with the token, and a revoked family is remembered for `JWT_REFRESH_TTL_S`. While Redis is unreachable, login, refresh and logout answer `503` and `/health/ready` reports the critical `auth-store` check as down, while requests carrying a valid access token keep working. Both stores pass the same contract test ([`refreshToken.repository.test.ts`](src/repository/refreshToken.repository.test.ts)), which is what a database version must pass too.

Protect a route by choosing its access strategy; see [`src/http/README.md`](src/http/README.md#access-rules). The handler then reads `req.user` (`{ id, email, role }`).

## OpenAPI

`GET /api/docs/openapi.json` returns an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document for every route under `/api`. Load it into Postman, Insomnia, Swagger Editor, or a client generator such as `openapi-typescript`. The template ships no UI and no extra dependency.

Nothing in the document is written by hand. It is built from two things the server already enforces, so it cannot drift from the code:

- **The route table** that `mount` records: method, full path, access rule and module. A `public` route gets `security: []`; any other route requires `bearerAuth` and lists a `401`; a `roles` route also lists a `403` and names its roles. The module name becomes the tag.
- **The `route()` contract** of each handler: `params` and `query` become parameters, `body` becomes the request body, and `response` plus `status` become the success response, wrapped in the `{ success, message, data, requestId }` envelope. A `204` has no body. A route with any input schema lists a `400`, and every operation has a `default` response with the `Error` envelope.

Input schemas are documented as the client sends them and response schemas as the server sends them, so a field with `.default()` is optional in a request but always present in a reply. Path parameters without a `params` schema are documented as strings. A handler that isn't wrapped in `route()` still appears, with only its path, access and error responses.

**Schemas that can't be described fail loudly.** `z.date()`, `z.bigint()`, `z.custom()` and a `.transform()` in a response schema have no JSON Schema form (a transform in an input schema is fine, so `z.coerce.number()` in a query works), so building the document throws with the route and the schema named, for example `POST /api/v1/user/register: the body schema cannot be represented in OpenAPI`. `query` and `params` must be object schemas. The document is built once, on the first request, and cached; the app test that fetches it against the real modules is what catches such a route in CI.

The document is public on purpose (it holds no user data). Its `info.title` is `SERVICE_NAME` and `info.version` is `SERVICE_VERSION`, which defaults to the `version` in `package.json` (and `SERVICE_NAME` to its `name`), however the process is started. To keep the document private, give the route in [`routes/api/docs.routes.ts`](src/routes/api/docs.routes.ts) a `roles` access rule, or drop `docsModule` from `apiModules` in [`modules/index.ts`](src/modules/index.ts).

## Health checks

Two endpoints the platform polls, plus a plain alias:

| Route | Question it answers | Running | Draining (after SIGTERM/SIGINT) |
|-------|---------------------|:---:|:---:|
| `GET /health/live` | Is the process alive? | `200` | **`200`** |
| `GET /health/ready` | Should it receive traffic? | `200`, or `503` if a critical dependency is down | **`503`** |
| `GET /health` | alias for `/ready` | same as `/ready` | `503` |

They live in [`routes/health/`](src/routes/health/) and [`controllers/health/`](src/controllers/health/), wired by [`modules/health.module.ts`](src/modules/health.module.ts), placed **first** in the route tree in [`app.ts`](src/app.ts) (outside the global rate limit and the request timeout), and already in the logger's ignore list, so probes never clutter the access log.

### Why two endpoints

Liveness and readiness fail for different reasons and the platform reacts differently to each:

- **Liveness failing → restart the process.** So it checks only things a restart could fix, and stays `200` even while shutting down. If it returned `503` during a drain, the platform could kill the process mid-shutdown and cut in-flight requests. (This is also why a database check must *never* go in liveness — an outage would restart every instance in a loop that can't fix anything.)
- **Readiness failing → stop sending traffic, but leave the process running.** It returns `503` the moment [`lifecycleState.isShuttingDown()`](src/lib/lifecycle/state.ts) flips. Combined with the drain delay (see [`src/lib/README.md`](src/lib/README.md#lifecycle)), this is what lets a rolling deploy move traffic off an instance before it closes — zero dropped requests. Dependency checks go **here** too: when Redis backs the rate limiter, `/health/ready` pings it. The body lists each dependency as `up` or `down` (never why), and whether a `down` one returns `503` depends on how critical it is. With `RATE_LIMIT_ON_STORE_ERROR=deny` a dead Redis returns `503`; with `local` or `allow` the app keeps serving through the outage, so it stays `200` and reports `status: "degraded"` rather than pulling every instance out of rotation. See [`src/lib/README.md`](src/lib/README.md#health).

### Design notes

- **No auth, no rate limiting in front of them.** A probe carries no credentials and must never get a `401` or `429`, which is why they mount before anything like that is added.
- **Probes get JSON, not an HTML error page.** The error handler negotiates `application/json` first (see [`wantsJson`](src/middlewares/error.middleware.ts)), so a `Accept: */*` probe — which is what kubelet and `curl` send — receives the JSON envelope. The draining `503` is logged at `warn`, not `error`, because shutting down is expected, not a fault.

In Kubernetes these map to the **startup**, **liveness** and **readiness** probes; set `SHUTDOWN_DELAY_MS` longer than the readiness probe interval so the drain outlasts one failed probe. The per-platform numbers are in [`src/lib/README.md`](src/lib/README.md#lifecycle).

## Conventions

- **ES Modules** — use `import` / `export`. Relative imports include the `.ts` extension (`./app.error.ts`).
- **Subpath imports** — import across folders with `#services/user.service` (no extension), never `../../services/...`.
- **Config vs constants** — tunable/env-dependent values go in `config/`; fixed facts go in `constants/`. `config/` may import `constants/`, never the reverse.
- **Naming** — files are `name.layer.ts` (`user.service.ts`); constants use `UPPERCASE_SNAKE_CASE`.
- **Secrets** — only ever in `.env`; config files *read* them via `process.env`, never hardcode. Add new sensitive field names to `redactPaths` in [`config/logger.config.ts`](src/config/logger.config.ts).
- **Error path first** — for every operation that can fail, handle the failure. Throw a typed error rather than returning `null` and checking upstream.

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run `src/*.ts` directly with `.env` loaded and auto-restart on changes (no type-check) |
| `pnpm typecheck` | Type-check the whole project with `tsc` (no output) |
| `pnpm typecheck:watch` | Same, re-running on every save |
| `pnpm build` | Clean `dist/`, then compile with `tsconfig.build.json` — fails on any type error |
| `pnpm start` | Run the compiled `dist/server.js` (expects env from the environment) |
| `pnpm lint` | ESLint (type-aware rules + layered-import enforcement) |
| `pnpm format` | Rewrite files with Prettier |
| `pnpm format:check` | Verify formatting without writing |
| `pnpm test` | Run `src/**/*.test.ts` with Node's built-in test runner (no Jest/Vitest) |
| `pnpm check` | Everything CI runs except the Docker job: typecheck → lint → format:check → test → build |
| `docker compose up --build --wait` | The production image plus Redis (needs `JWT_SECRET`); see [Docker](#docker) |

## Roadmap

- [x] Layered skeleton, `app.ts` / `server.ts` split
- [x] Request IDs + async context
- [x] Structured logging + HTTP access logs
- [x] Error hierarchy, converters, central handler
- [x] Response envelope + pagination
- [x] JSON body parsing on `/api`
- [x] Form body parsing (`express.urlencoded`) and static file serving
- [x] Security headers (`helmet`), static assets, and `trust proxy`
- [x] CORS, off until `CORS_ENABLED=true`
- [x] Idempotency keys for retried writes
- [x] Env validation (zod) — reject malformed values at boot
- [x] Input validation at the controller boundary (`route()` + Zod)
- [x] Required access rule on every route (`public` / `authenticated` / `roles`), `authorize` middleware
- [x] Auth: register, login, JWT access tokens, rotating refresh tokens with reuse detection, logout, `GET /api/v1/user/me`
- [x] Refresh tokens in memory or Redis, behind one contract test
- [x] OpenAPI 3.1 document generated from the route table
- [x] Docker image and Compose file with Redis
- [x] Health checks: liveness + readiness endpoints
- [x] Graceful shutdown + `unhandledRejection` / `uncaughtException` handling
- [x] Tests: unit tests plus real HTTP tests against a listening app (Node's test runner and `fetch`, no extra framework); Redis integration tests in CI
