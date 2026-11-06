import type { RequestHandler } from 'express';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';
import type { Registry } from '#http/registry';
import { defineGroup, defineRoute } from '#http/routes';

const probe = { strategy: 'public', reason: 'Platform probes carry no credentials' } as const;

const noStore: RequestHandler = (_req, res, next) => {
  res.set(HTTP_HEADERS.CACHE_CONTROL, 'no-store');
  next();
};

export const healthRoutes = ({ healthController }: Pick<Registry, 'healthController'>) =>
  defineGroup(
    '/health',
    [
      defineRoute({ method: 'get', path: '/', access: probe, handlers: [healthController.ready] }),
      defineRoute({
        method: 'get',
        path: '/ready',
        access: probe,
        handlers: [healthController.ready],
      }),
      defineRoute({
        method: 'get',
        path: '/live',
        access: probe,
        handlers: [healthController.live],
      }),
    ],
    { use: [noStore] },
  );
