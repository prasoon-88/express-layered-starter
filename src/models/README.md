# models/

**Responsibility:** Define the shape and rules of your data — the schemas/structures that map to database collections or tables.

## What goes here
- Schema definitions (Mongoose schemas, Sequelize/Prisma models, etc.)
- Field types, required fields, defaults, unique constraints
- Model-level validation (e.g. email must match a pattern)
- Relationships between data (a Post belongs to a User)

## What does NOT go here
- ❌ Business logic (that's `services/`)
- ❌ Query functions (that's `repository/`)
- ❌ HTTP handling (that's `controllers/`)

A model describes **what the data looks like**, not what you do with it.

## Example
```js
// models/post.model.js
import { Schema, model } from 'mongoose'

const postSchema = new Schema({
    title:   { type: String, required: true },
    body:    { type: String, required: true },
    slug:    { type: String, unique: true },
    author:  { type: Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
})

export default model('Post', postSchema)
```

## Rule of thumb
> A model is the "blueprint" of a record. It defines structure and storage rules — the repository uses it to read/write, the service uses the data it returns.
