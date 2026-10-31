# contexts/

**Responsibility:** Request-scoped state that any code can read without it being passed down as an argument. Built on Node's `AsyncLocalStorage`.

## The problem it solves

You want every log line to carry the current request ID. Without a context, that means threading `req` from the controller into the service, into the repository, into every helper — polluting signatures that have nothing to do with HTTP:

```js
// ❌ the alternative
const getUser = async (id, req) => {
    logger.info({ requestId: req.id }, 'fetching')
    return userRepository.findById(id, req)
}
```

With a context, the value travels with the async execution itself:

```js
// ✅
const getUser = async (id) => {
    logger.info('fetching')          // requestId attached automatically
    return userRepository.findById(id)
}
```

## What goes here

- `createContext.js` — a thin, generic `AsyncLocalStorage` wrapper
- One file per distinct context, exposing **named getters**, never the raw store

## What does NOT go here

- ❌ Application state that outlives a request (cache, config, connections)
- ❌ Business data passed between layers — that's what function arguments are for
- ❌ Anything you'd be tempted to *write* to mid-request from a deep layer

## How it works

`requestId.middleware.js` opens the context once, at the very start of the request:

```js
requestContext.run({ requestId: id }, next)
```

Everything `next()` triggers — synchronous or `await`ed, however deep — can read it:

```js
import requestContext from '#contexts/requestContext.js'

requestContext.getRequestId()   // '3f2b…'
```

The logger does exactly this in its `mixin`, which is why every line is tagged with no effort from the caller. [`apiResponse`](../utils/apiResponse.util.js) does the same to include `requestId` in every response body.

## Adding to the context

Expose a getter — don't leak the store:

```js
const STORE_KEYS = Object.freeze({
    REQUEST_ID: 'requestId',
    USER_ID: 'userId',
})

const requestContext = {
    STORE_KEYS,
    run: context.run,
    getRequestId: () => context.get(STORE_KEYS.REQUEST_ID),
    getUserId: () => context.get(STORE_KEYS.USER_ID),
}
```

Named getters keep the call sites readable and the key strings in one place.

## Gotchas

- **Outside a `run()`, every getter returns `undefined`.** Startup code, background jobs, and `setInterval` callbacks have no context. Always handle the missing case — the logger's mixin returns `{}` rather than a key with `undefined`.
- **Don't make it a hidden parameter.** If a service genuinely needs a user ID to do its job, take it as an argument. The context is for ambient metadata (tracing, correlation), not for smuggling inputs past a function signature.
- **Not free, but close.** `AsyncLocalStorage` has a small cost. Store identifiers, not large objects.

## Rule of thumb

> If leaving it out would only make your logs worse, it belongs in the context. If leaving it out would break the logic, it belongs in the arguments.
