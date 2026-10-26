# src/ — Architecture Overview

This app uses a **layered architecture**. Each layer has one job and only talks to the layer directly below it. This keeps code easy to find, test, and change.

## The layers

| Layer | Folder | Responsibility | Touches `req`/`res`? | Touches DB? |
|-------|--------|----------------|:---:|:---:|
| Route | [`routes/`](routes/) | Map URL → controller | ❌ | ❌ |
| Controller | [`controllers/`](controllers/) | HTTP: read req, send res | ✅ | ❌ |
| Service | [`services/`](services/) | Business logic & rules | ❌ | ❌ |
| Repository | [`repository/`](repository/) | Raw database access | ❌ | ✅ |
| Model | [`models/`](models/) | Data shape / schema | ❌ | — |

**Shared (usable by any layer):**
[`config/`](config/) · [`constants/`](constants/) · [`utils/`](utils/)
**Presentation:** [`views/`](views/) (SSR templates)

## Request flow

```
HTTP request
   ↓
routes/        "GET /posts/:id → postController.getPost"
   ↓
controllers/   read req.params.id → call service → res.json()
   ↓
services/      "exists? allowed? shape it" — the rules
   ↓
repository/    db query (findById)
   ↓
models/ → Database
```

Each arrow is a one-way handoff. Data flows down as calls, back up as return values.

## A feature across all layers (example: get one post)

```js
// routes/post.routes.js
postRouter.get('/posts/:id', postController.getPost)
```
```js
// controllers/post.controller.js — HTTP only
export const getPost = async (req, res) => {
    try {
        const post = await postService.getPostById(req.params.id)
        res.json(post)
    } catch (err) {
        res.status(404).json({ message: err.message })
    }
}
```
```js
// services/post.service.js — the rules
export const getPostById = async (id) => {
    const post = await postRepository.findById(id)
    if (!post) throw new Error('Post not found')   // business rule
    return post
}
```
```js
// repository/post.repository.js — raw DB
export const findById = (id) => Post.findById(id)
```

## Where does my code go? (decision guide)

| Ask yourself... | Put it in |
|-----------------|-----------|
| Does it touch `req` / `res`? | `controllers/` |
| Is it a rule, decision, or sequence of steps? | `services/` |
| Does it run a database query? | `repository/` |
| Does it define a data shape/schema? | `models/` |
| Is it a tunable setting (maybe from `.env`)? | `config/` |
| Is it a fixed value that never changes? | `constants/` |
| Is it a tiny generic helper (pure function)? | `utils/` |
| Is it a page template to display? | `views/` |

## Dependency rules (what may import what)

```
constants/   ← depends on nothing
   ↑
config/      ← may use constants
   ↑
utils/       ← may use config + constants
   ↑
repository/  ← uses models
   ↑
services/    ← uses repository, utils, config
   ↑
controllers/ ← uses services
   ↑
routes/      ← uses controllers
```

**Dependencies point downward only.** A lower layer must never import an upper layer (e.g. a service never imports a controller) — that creates circular dependencies and breaks reusability.

> Each folder has its own `README.md` with detailed rules and examples. Start there when adding code to a layer you're unsure about.
