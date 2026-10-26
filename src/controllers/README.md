# controllers/

**Responsibility:** Handle the HTTP layer — read the request, call a service, send the response. The "translator" between the web and your app's logic.

## What goes here
- Reading input: `req.params`, `req.body`, `req.query`, `req.file`
- Calling a service to do the actual work
- Sending the response: `res.json()`, `res.render()`, `res.redirect()`, status codes
- Catching errors and turning them into HTTP responses

## What does NOT go here
- ❌ Business rules / validation logic (that's `services/`)
- ❌ Database access (that's `repository/`)
- ❌ Knowing *how* data is stored or computed

The controller should read like a short script: get input → call service → send output.

## Example
```js
// controllers/post.controller.js
import * as postService from '../services/post.service.js'

export const getPost = async (req, res) => {
    try {
        const post = await postService.getPostById(req.params.id)  // service does the work
        res.json(post)
    } catch (err) {
        res.status(404).json({ message: err.message })
    }
}
```

## The test
> Does this code touch `req` or `res`? → it belongs here.
> Is it a rule or a decision? → push it down to the service.

## Rule of thumb
> A controller never queries the database and never contains business rules. It only translates HTTP ↔ service calls.
