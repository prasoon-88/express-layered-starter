# views/

**Responsibility:** Server-side rendered templates — the HTML pages the server generates and sends to the browser (SSR).

## What goes here
- Template files (`.ejs`, `.pug`, `.hbs`, etc.)
- Layouts and partials (shared header/footer/nav)
- Markup with placeholders for data the controller passes in

## What does NOT go here
- ❌ Business logic (that's `services/`)
- ❌ Database access (that's `repository/`)
- ❌ Heavy JavaScript computation — keep templates focused on *display*

Templates should only *present* data, not fetch or compute it. The controller prepares the data and passes it in via `res.render('page', { data })`.

## Example
```js
// a controller renders a view:
export const showPost = async (req, res) => {
    const post = await postService.getPostById(req.params.id)
    res.render('post', { post })   // hands data to the template
}
```
```html
<!-- views/post.ejs -->
<h1><%= post.title %></h1>
<p><%= post.body %></p>
```

## Setup reminder
These must be registered in your app entry (`index.js`):
```js
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
```

## Rule of thumb
> Views are for display only. If you see a `db.` call or a business rule inside a template, it's in the wrong place — move it to the controller/service and pass the result in.
