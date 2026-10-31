# express-layered-starter

A Node.js + Express starter built on a clean **layered architecture** (routes → controllers → services → repository). It ships the parts every backend needs and nobody enjoys rebuilding — request-scoped logging, an error hierarchy with framework converters, uniform API responses, and pagination — so a new project starts at the interesting part.

`main` is **database-agnostic**. Each database integration lives on its own branch.

## What's already built

| Capability | Where |
|------------|-------|
| Layered architecture with enforced dependency direction | [`src/README.md`](src/README.md) |
| Request IDs, propagated without passing `req` around | [`contexts/`](src/contexts/) · [`requestId.middleware.js`](src/middlewares/requestId.middleware.js) |
| Structured JSON logging with secret redaction | [`lib/logger/`](src/lib/logger/) · [`logger.config.js`](src/config/logger.config.js) |
| HTTP access logs with duration + slow-request warnings | [`httpLogger.middleware.js`](src/middlewares/httpLogger.middleware.js) |
| Error class hierarchy + converters + central handler | [`errors/`](src/errors/) · [`error.middleware.js`](src/middlewares/error.middleware.js) |
| Uniform success/error response envelope | [`apiResponse.util.js`](src/utils/apiResponse.util.js) |
| Validated pagination (parse, clamp, build meta) | [`paginator.util.js`](src/utils/paginator.util.js) |
| Graceful shutdown + process-level crash handling | [`lib/lifecycle/`](src/lib/lifecycle/) · [`server.js`](src/server.js) |
| Health checks (liveness + readiness) | [`routes/health/`](src/routes/health/) · [`controllers/health/`](src/controllers/health/) |
| Security headers, static serving, proxy-aware client IPs | [`app.js`](src/app.js) (`helmet`, `express.static`, `trust proxy`) |
| Subpath imports (`#services/*`, `#errors`, …) | `package.json` → `imports` |

## Tech stack

| Tool | Purpose |
|------|---------|
| [Express 5](https://expressjs.com/) | Web framework / HTTP server |
| [pino](https://getpino.io/) | Structured JSON logging (`pino-pretty` in dev) |
| [EJS](https://ejs.co/) | Server-side rendered views |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | JWT — error converter wired, auth not yet built |
| [helmet](https://helmetjs.github.io/) | Security headers, mounted on every response |
| ES Modules | `"type": "module"` — `import` / `export` |
| `node --env-file` | Native `.env` loading, no `dotenv` |

## Getting started

### Prerequisites

- **Node.js ≥26** — enforced via `engines` + `.npmrc` (`engine-strict`). Use the pinned version with `nvm use` (reads [`.nvmrc`](.nvmrc)).
- **pnpm** is the only supported package manager. Enable it with Corepack (ships with Node): `corepack enable pnpm`. A `preinstall` guard rejects `npm` and `yarn`.

### Install

```bash
pnpm install
```

### Environment

Create a `.env` in the project root — it is gitignored, never commit it:

```bash
# General
SERVICE_NAME=express-layered-starter
PORT=8000
NODE_ENV=development
TRUST_PROXY=                            # hops to trust behind a proxy: a number (1, 2), true/false, or "loopback"/a subnet. Empty = false (local)

# Logging
LOG_LEVEL=info                          # trace | debug | info | warn | error | fatal
LOG_PRETTY=true                         # human-readable output; JSON when false
LOG_IGNORE_PATHS=/health,/favicon.ico   # paths excluded from access logs
LOG_SLOW_MS=1000                        # requests at or above this are logged as warnings

# Shutdown
SHUTDOWN_TIMEOUT_MS=8000                # total budget (ms) before a stuck shutdown is force-killed
SHUTDOWN_DELAY_MS=5000                  # ms to keep serving after SIGTERM/SIGINT so load balancers can drain us (0 = none)
```

Every variable has a fallback in [`src/constants/env.constant.js`](src/constants/env.constant.js), so the app boots with an empty `.env`.

`SHUTDOWN_DELAY_MS` must be smaller than `SHUTDOWN_TIMEOUT_MS`, or the app refuses to start. Set it to `0` locally so Ctrl+C exits at once; see [`src/lib/README.md`](src/lib/README.md#lifecycle) for tuning per platform.

`TRUST_PROXY` sets Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html), which decides how `req.ip` is read behind a reverse proxy. Its meaning depends on the type: a **number** trusts that many hops (`1` for a single nginx/load balancer), `true`/`false` trust all/none, and a string like `loopback` or a subnet trusts specific addresses. Leave it empty locally (no proxy); set it to the real hop count in production, or a client can forge their IP.

### Run

```bash
pnpm dev
```

Loads `.env` and restarts on file changes. The server listens on `PORT` (default `8000`).

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
└── src/
    ├── app.js           # builds the Express app — middleware + routes, no listen()
    ├── server.js        # entry point — starts the HTTP server
    ├── config/          # tunable settings, derived from env
    ├── constants/       # fixed values that never change
    ├── contexts/        # AsyncLocalStorage — request-scoped state
    ├── controllers/     # HTTP layer (req/res), calls services
    ├── errors/          # error classes + framework error converters
    ├── lib/             # wrappers around external systems (logger, process lifecycle)
    ├── middlewares/     # cross-cutting request concerns
    ├── models/          # data shapes / DB schemas
    ├── repository/      # database access only
    ├── routes/          # URL → controller mapping
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
import { getLogger } from '#lib/logger/index.js'
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

The handler normalizes anything thrown — including framework errors from JWT or your database driver, via [`errors/converter/`](src/errors/converter/) — then logs it and responds in the right format: JSON for `/api` routes, a rendered `error` view otherwise. Stack traces are included outside production only.

## Responses

```js
import { apiResponse } from '#utils/apiResponse.util.js'

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

They live in [`routes/health/`](src/routes/health/) and [`controllers/health/`](src/controllers/health/), mounted **first** in [`routes/index.js`](src/routes/index.js) and already in the logger's ignore list, so probes never clutter the access log.

### Why two endpoints

Liveness and readiness fail for different reasons and the platform reacts differently to each:

- **Liveness failing → restart the process.** So it checks only things a restart could fix, and stays `200` even while shutting down. If it returned `503` during a drain, the platform could kill the process mid-shutdown and cut in-flight requests. (This is also why a database check must *never* go in liveness — an outage would restart every instance in a loop that can't fix anything.)
- **Readiness failing → stop sending traffic, but leave the process running.** It returns `503` the moment [`lifecycleState.isShuttingDown()`](src/lib/lifecycle/state.js) flips. Combined with the drain delay (see [`src/lib/README.md`](src/lib/README.md#lifecycle)), this is what lets a rolling deploy move traffic off an instance before it closes — zero dropped requests. Later, a database or dependency check goes **here**.

### Design notes

- **No auth, no rate limiting in front of them.** A probe carries no credentials and must never get a `401` or `429`, which is why they mount before anything like that is added.
- **Probes get JSON, not an HTML error page.** The error handler negotiates `application/json` first (see [`wantsJson`](src/middlewares/error.middleware.js)), so a `Accept: */*` probe — which is what kubelet and `curl` send — receives the JSON envelope. The draining `503` is logged at `warn`, not `error`, because shutting down is expected, not a fault.

In Kubernetes these map to the **startup**, **liveness** and **readiness** probes; set `SHUTDOWN_DELAY_MS` longer than the readiness probe interval so the drain outlasts one failed probe. The per-platform numbers are in [`src/lib/README.md`](src/lib/README.md#lifecycle).

## Conventions

- **ES Modules** — use `import` / `export`, always include the `.js` extension in local imports.
- **Subpath imports** — import across folders with `#services/user.service.js`, never `../../services/...`.
- **Config vs constants** — tunable/env-dependent values go in `config/`; fixed facts go in `constants/`. `config/` may import `constants/`, never the reverse.
- **Naming** — files are `name.layer.js` (`user.service.js`); constants use `UPPERCASE_SNAKE_CASE`.
- **Secrets** — only ever in `.env`; config files *read* them via `process.env`, never hardcode. Add new sensitive field names to `redactPaths` in [`config/logger.config.js`](src/config/logger.config.js).
- **Error path first** — for every operation that can fail, handle the failure. Throw a typed error rather than returning `null` and checking upstream.

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Start with `.env` loaded and auto-restart on changes |
| `pnpm start` | Start without the watcher (expects env from the environment) |
| `pnpm lint` | ESLint (recommended rules + layered-import enforcement) |
| `pnpm format` | Rewrite files with Prettier |
| `pnpm format:check` | Verify formatting without writing |

## Roadmap

- [x] Layered skeleton, `app.js` / `server.js` split
- [x] Request IDs + async context
- [x] Structured logging + HTTP access logs
- [x] Error hierarchy, converters, central handler
- [x] Response envelope + pagination
- [x] JSON body parsing on `/api`
- [x] Form body parsing (`express.urlencoded`) and static file serving
- [x] Security headers (`helmet`), static assets, and `trust proxy`
- [ ] CORS (when a cross-origin client needs it)
- [ ] Env validation (zod) — reject malformed values at boot
- [ ] Input validation at the controller boundary
- [ ] Auth: register / login with JWT
- [x] Health checks: liveness + readiness endpoints
- [x] Graceful shutdown + `unhandledRejection` / `uncaughtException` handling
- [ ] Tests
