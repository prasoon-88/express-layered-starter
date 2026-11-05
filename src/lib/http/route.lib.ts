import type { Request, Response, RequestHandler } from 'express';
import { ZodError, ZodRealError } from 'zod';
import type { z, ZodType } from 'zod';
import HTTP_STATUS from '#constants/http/httpStatus.constant';
import { buildSuccessBody } from './successEnvelope.lib.ts';

type Schemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  response?: ZodType;
};

type Infer<T> = T extends ZodType ? z.infer<T> : undefined;

type Input<S extends Schemas> = {
  body: Infer<S['body']>;
  query: Infer<S['query']>;
  params: Infer<S['params']>;
};

const LOCATIONS = ['body', 'query', 'params'] as const;

export function route<S extends Schemas>(
  schemas: S,
  handler: (input: Input<S>, req: Request, res: Response) => unknown,
  opts: { status?: number } = {},
): RequestHandler {
  return async (req, res, next) => {
    // Phase 1 — input. Only a ZodError raised here is the client's fault (400).
    // Every location is checked so the client gets all failures at once, each
    // path prefixed with where it came from (body.email, query.page, params.id).
    const input: Partial<Record<(typeof LOCATIONS)[number], unknown>> = {};
    const issues: ZodError['issues'] = [];
    try {
      for (const loc of LOCATIONS) {
        const schema = schemas[loc];
        if (!schema) continue;
        const parsed = await schema.safeParseAsync(req[loc]);
        if (parsed.success) input[loc] = parsed.data;
        else issues.push(...parsed.error.issues.map((i) => ({ ...i, path: [loc, ...i.path] })));
      }
    } catch (err) {
      return next(err); // a refine/transform that throws is a server bug -> 500
    }
    // ZodRealError, not ZodError: in zod v4 only the former is a real Error with a stack.
    if (issues.length) return next(new ZodRealError(issues));

    // Phase 2 — handler and response. A ZodError here (e.g. the handler validating
    // DB data) is a server bug, so it is wrapped to reach the 500 path, not the 400 one.
    try {
      const result = await handler(input as Input<S>, req, res);
      if (res.headersSent) return;
      let out = result;
      if (schemas.response) {
        const parsed = await schemas.response.safeParseAsync(out);
        if (!parsed.success) throw new Error(`Response schema mismatch: ${parsed.error.message}`);
        out = parsed.data;
      }
      const status = opts.status ?? HTTP_STATUS.OK;
      if (status === HTTP_STATUS.NO_CONTENT) {
        res.status(status).end(); // a 204 has no body, so there is no envelope to send
        return;
      }
      res.status(status).json(buildSuccessBody(status, { data: out }));
    } catch (err) {
      next(
        err instanceof ZodError
          ? new Error('ZodError thrown outside input validation', { cause: err })
          : err,
      );
    }
  };
}
