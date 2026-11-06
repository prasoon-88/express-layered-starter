// Project-wide additions to Express's own types (declaration merging).
// Type-only: nothing in this file exists at runtime.
import type { AuthUser } from '#schemas/user.schema';

declare global {
  namespace Express {
    interface Request {
      /** Set for every request by requestId.middleware, which runs before any route. */
      id: string;

      /**
       * Set by `authenticate` on every route whose access strategy is not `public`, after
       * validating with `authUserSchema`. Typed as always present so protected handlers need no
       * checks. On public routes it is `undefined` at runtime, so never read it there.
       */
      user: AuthUser;

      /**
       * Set by requestTimeout.middleware before any route.
       * Aborted when the handler budget is exceeded, or when the client disconnects.
       * Node's `req.signal` stays the platform signal. Cancel downstream work with
       * `AbortSignal.any([req.signal, req.deadline])`.
       */
      deadline: AbortSignal;
    }

    interface Locals {
      /** Optional error code a handler can attach so the HTTP access log records it. */
      errorCode?: string;
    }
  }
}

export {};
