# express-layered-starter

A Node.js + Express starter built on a clean **layered architecture** (routes → controllers → services → repository). It ships the parts every backend needs and nobody enjoys rebuilding — request-scoped logging, an error hierarchy with framework converters, request validation, uniform API responses, and pagination — so a new project starts at the interesting part.

`main` is **database-agnostic**. Each database integration lives on its own branch.

## What's already built

| Capability | Where |
|------------|-------|
| Layered architecture with enforced dependency direction | [`src/README.md`](src/README.md) |
| Request IDs, propagated without passing `req` around | [`contexts/`](src/contexts/) · [`requestId.middleware.ts`](src/middlewares/requestId.middleware.ts) |
| Structured JSON logging with secret redaction | [`lib/logger/`](src/lib/logger/) · [`logger.config.ts`](src/config/logger.config.ts) |
| HTTP access logs with duration + slow-request warnings | [`httpLogger.middleware.ts`](src/middlewares/httpLogger.middleware.ts) |
| Error class hierarchy + converters + central handler | [`errors/`](src/errors/) · [`error.middleware.ts`](src/middlewares/error.middleware.ts) |
| Request validation (body, query, params, response) with Zod | [`lib/http/route.lib.ts`](src/lib/http/route.lib.ts) · [`zod.converter.ts`](src/errors/converter/zod.converter.ts) |
| Uniform success/error response envelope | [`apiResponse.util.ts`](src/utils/apiResponse.util.ts) |
| Validated pagination (parse, clamp, build meta) | [`paginator.util.ts`](src/utils/paginator.util.ts) |
| Graceful shutdown + process-level crash handling | [`lib/lifecycle/`](src/lib/lifecycle/) · [`server.ts`](src/server.ts) |
| Health checks (liveness + readiness) | [`routes/health/`](src/routes/health/) · [`controllers/health/`](src/controllers/health/) |
| Security headers, static serving, proxy-aware client IPs | [`app.ts`](src/app.ts) (`helmet`, `express.static`, `trust proxy`) |
| Subpath imports (`#services/*`, `#errors`, …) | `package.json` → `imports` |

## Tech stack

| Tool | Purpose |
|------|---------|
| [Express 5](https://expressjs.com/) | Web framework / HTTP server |
| [pino](https://getpino.io/) | Structured JSON logging (`pino-pretty` in dev) |
| [Zod 4](https://zod.dev/) | Request and response validation through [`route()`](src/lib/http/route.lib.ts) |
| [EJS](https://ejs.co/) | Server-side rendered views |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | JWT — error converter wired, auth not yet built |
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
- **pnpm** is the only supported package manager. Enable it with Corepack (ships with Node): `corepack enable pnpm`. A `preinstall` guard rejects `npm` and `yarn`.

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
- Every other variable has a default, and an empty value (`KEY=`) counts as unset.

`SHUTDOWN_DELAY_MS` must be smaller than `SHUTDOWN_TIMEOUT_MS`, or the app refuses to start. Set it to `0` locally so Ctrl+C exits at once; see [`src/lib/README.md`](src/lib/README.md#lifecycle) for tuning per platform.

`TRUST_PROXY` sets Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html), which decides how `req.ip` is read behind a reverse proxy. Its meaning depends on the type: a **number** trusts that many hops (`1` for a single nginx/load balancer), `true`/`false` trust all/none, and a string like `loopback` or a subnet trusts specific addresses. Leave it empty locally (no proxy); set it to the real hop count in production, or a client can forge their IP.

### Run

```bash
pnpm dev
```

Loads `.env` and restarts on file changes. The server listens on `PORT` (default `8000`).

Node strips the types and runs `src/*.ts` as-is, so **dev never type-checks**. Your editor shows errors live; for a terminal view run `pnpm typecheck:watch` alongside `pnpm dev`.

### Build for production

```bash
pnpm build   # type-check + compile src/ -> dist/ (no output at all if any type error)
pnpm start   # node dist/server.js
```

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
├── dist/                # compiled output (gitignored)
└── src/
    ├── app.ts           # builds the Express app — middleware + routes, no listen()
    ├── server.ts        # entry point — starts the HTTP server
    ├── config/          # tunable settings, derived from env
    ├── constants/       # fixed values that never change
    ├── contexts/        # AsyncLocalStorage — request-scoped state
    ├── controllers/     # HTTP layer (req/res), calls services
    ├── errors/          # error classes + framework error converters
    ├── lib/             # wrappers around external systems (logger, process lifecycle, route())
    ├── middlewares/     # cross-cutting request concerns
    ├── models/          # data shapes / DB schemas
    ├── repository/      # database access only
    ├── routes/          # URL → controller mapping
    ├── types/           # project-wide type augmentations (*.d.ts)
    ├── services/        # business logic, rules, orchestration
    ├── utils/           # small pure helpers
    └── views/           # EJS templates
```

> Every folder has its own `README.md` explaining exactly what belongs in it. See [`src/README.md`](src/README.md) for how the layers connect.

## Architecture in one picture

```
HTTP request
   ↓
requestId  →  httpLogger                 (cross-cutting middleware)
   ↓
routes/        which URL → which controller
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

Wrap a controller in [`route()`](src/lib/http/route.lib.ts) and give it Zod schemas. The handler receives parsed, typed input, and whatever it returns is sent as JSON:

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

Every response carries the same envelope:

```json
{ "success": true, "message": "Success", "data": {}, "requestId": "3f2b…" }
```

## Health checks

Two endpoints the platform polls, plus a plain alias:

| Route | Question it answers | Running | Draining (after SIGTERM/SIGINT) |
|-------|---------------------|:---:|:---:|
| `GET /health/live` | Is the process alive? | `200` | **`200`** |
| `GET /health/ready` | Should it receive traffic? | `200` | **`503`** |
| `GET /health` | alias for `/ready` | `200` | `503` |

They live in [`routes/health/`](src/routes/health/) and [`controllers/health/`](src/controllers/health/), mounted **first** in [`routes/index.ts`](src/routes/index.ts) and already in the logger's ignore list, so probes never clutter the access log.

### Why two endpoints

Liveness and readiness fail for different reasons and the platform reacts differently to each:

- **Liveness failing → restart the process.** So it checks only things a restart could fix, and stays `200` even while shutting down. If it returned `503` during a drain, the platform could kill the process mid-shutdown and cut in-flight requests. (This is also why a database check must *never* go in liveness — an outage would restart every instance in a loop that can't fix anything.)
- **Readiness failing → stop sending traffic, but leave the process running.** It returns `503` the moment [`lifecycleState.isShuttingDown()`](src/lib/lifecycle/state.ts) flips. Combined with the drain delay (see [`src/lib/README.md`](src/lib/README.md#lifecycle)), this is what lets a rolling deploy move traffic off an instance before it closes — zero dropped requests. Later, a database or dependency check goes **here**.

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
| `pnpm check` | Everything CI runs: typecheck → lint → format:check → test → build |

## Roadmap

- [x] Layered skeleton, `app.ts` / `server.ts` split
- [x] Request IDs + async context
- [x] Structured logging + HTTP access logs
- [x] Error hierarchy, converters, central handler
- [x] Response envelope + pagination
- [x] JSON body parsing on `/api`
- [x] Form body parsing (`express.urlencoded`) and static file serving
- [x] Security headers (`helmet`), static assets, and `trust proxy`
- [ ] CORS (when a cross-origin client needs it)
- [x] Env validation (zod) — reject malformed values at boot
- [x] Input validation at the controller boundary (`route()` + Zod)
- [ ] Auth: register / login with JWT
- [x] Health checks: liveness + readiness endpoints
- [x] Graceful shutdown + `unhandledRejection` / `uncaughtException` handling
- [ ] Tests — env schema covered; HTTP tests (`supertest`) next
