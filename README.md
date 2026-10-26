# Blog Application

A Node.js + Express blog backend, built with a clean **layered architecture** (routes → controllers → services → repository). This project is a learning exercise in structuring a real backend the way production apps are organized.

## Tech stack

| Tool | Purpose |
|------|---------|
| [Express 5](https://expressjs.com/) | Web framework / HTTP server |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | JWT authentication |
| EJS *(if used)* | Server-side rendered views |
| ES Modules | `"type": "module"` — uses `import`/`export` |

## Getting started

### Prerequisites
- Node.js **20.6+** (required for the built-in `--env-file` flag)

### Install
```bash
npm install
```

### Environment
Create a `.env` file in the project root (it is gitignored — never commit it):
```bash
PORT=3000
JWT_SECRET=replace-with-a-long-random-string
# DB_URL=...        # add when a database is wired up
```

### Run (development)
```bash
npm run dev
```
This runs `node --env-file=.env --watch src/index.js` — it loads `.env` and auto-restarts on file changes.

The server starts on the port from `.env` (`http://localhost:3000` by default).

## Project structure

```
blog-application/
├── .env                 # secrets & env config (gitignored)
├── package.json
└── src/
    ├── index.js         # app entry point — wires everything together
    ├── config/          # tunable settings (reads from .env)
    ├── constants/       # fixed values that never change
    ├── routes/          # URL → controller mapping
    ├── controllers/     # HTTP layer (req/res), calls services
    ├── services/        # business logic, rules, orchestration
    ├── repository/      # raw database access only
    ├── models/          # data shapes / DB schemas
    ├── utils/           # small pure helper functions
    └── views/           # server-side rendered templates
```

> Each folder has its own `README.md` explaining exactly what belongs in it. See [`src/README.md`](src/README.md) for how the layers connect.

## Architecture in one picture

```
HTTP request
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

   (config / constants / utils are available to every layer)
```

**The golden rule:** each layer only talks to the one directly below it.
- Controllers never query the database.
- Services never touch `req` / `res`.
- Repositories never contain business rules.

## Conventions

- **ES Modules** — use `import` / `export`, always include the `.js` extension in local imports.
- **Config vs constants** — tunable/env-dependent values go in `config/`; fixed facts go in `constants/`. `config/` may import `constants/`, never the reverse.
- **Naming** — settings and constants use `UPPERCASE_SNAKE_CASE`.
- **Secrets** — only ever in `.env`; config files *read* them via `process.env`, never hardcode.
- **Error path first** — for every operation that can fail, handle the failure (missing input, not found, DB error) — don't just code the happy path.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the server with `.env` loaded and auto-restart on changes |

## Roadmap / TODO

- [ ] Wire up `src/index.js` (Express app, middleware, mount routers)
- [ ] Add a database (models + repository)
- [ ] Posts feature: create, list, read, update, delete
- [ ] Auth: register / login with JWT
- [ ] Error-handling middleware
- [ ] Input validation
- [ ] Tests
