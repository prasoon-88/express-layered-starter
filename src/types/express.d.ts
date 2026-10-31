// Project-wide additions to Express's own types (declaration merging).
// Type-only: nothing in this file exists at runtime.
declare global {
  namespace Express {
    interface Request {
      /** Set for every request by requestId.middleware, which runs before any route. */
      id: string;
    }

    interface Locals {
      /** Optional error code a handler can attach so the HTTP access log records it. */
      errorCode?: string;
    }
  }
}

export {};
