import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { route, getRouteContract } = await import('./route.ts');
const { apiResponse } = await import('#utils/apiResponse.util');
const { requestContext } = await import('#contexts/requestContext');

class FakeResponse {
  headersSent = false;
  statusCode = 0;
  sends = 0;
  ended = false;
  body: unknown;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.sends++;
    this.body = body;
    this.headersSent = true;
    return this;
  }

  end() {
    this.ended = true;
    this.headersSent = true;
    return this;
  }
}

const inRequest = <R>(work: () => R) => requestContext.run({ requestId: 'req-7' }, work);

const run = async (handler: ReturnType<typeof route>) => {
  const res = new FakeResponse();
  const nextCalls: unknown[] = [];
  const next: NextFunction = (err?: unknown) => {
    nextCalls.push(err);
  };
  const req = { body: {}, query: {}, params: {} } as unknown as Request;

  await inRequest(() => handler(req, res as unknown as Response, next));
  return { res, nextCalls };
};

const viaHelper = (send: (res: Response) => unknown) => {
  const res = new FakeResponse();
  inRequest(() => send(res as unknown as Response));
  return res;
};

describe('route() success response', () => {
  it('sends the same envelope as apiResponse.ok', async () => {
    const { res } = await run(route({}, () => ({ id: 1 })));
    const expected = viaHelper((r) => apiResponse.ok(r, { id: 1 }));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, expected.body);
    assert.deepEqual(res.body, {
      success: true,
      message: 'Success',
      data: { id: 1 },
      requestId: 'req-7',
    });
  });

  it('sends the same envelope as apiResponse.created for status 201', async () => {
    const { res } = await run(route({}, () => ({ id: 1 }), { status: 201 }));
    const expected = viaHelper((r) => apiResponse.created(r, { id: 1 }));

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, expected.body);
  });

  it('puts null in data when the handler returns nothing', async () => {
    const { res } = await run(route({}, () => undefined));

    assert.equal((res.body as { data: unknown }).data, null);
  });

  it('sends no body for status 204', async () => {
    const { res } = await run(route({}, () => undefined, { status: 204 }));

    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
    assert.equal(res.body, undefined);
  });

  it('strips fields the response schema does not name, inside data', async () => {
    const { res } = await run(
      route({ response: z.object({ id: z.number() }) }, () => ({ id: 1, passwordHash: 'x' })),
    );

    assert.deepEqual((res.body as { data: unknown }).data, { id: 1 });
  });

  it('reports a response that fails its schema as an error, never as a success', async () => {
    const { res, nextCalls } = await run(
      route({ response: z.object({ id: z.number() }) }, () => ({ id: 'not a number' })),
    );

    assert.equal(res.sends, 0);
    assert.equal(nextCalls.length, 1);
    assert.ok(nextCalls[0] instanceof Error);
  });

  it('steps aside when the handler already sent the response', async () => {
    const { res } = await run(
      route({}, (_input, _req, response) => apiResponse.ok(response, { sentBy: 'handler' })),
    );

    assert.equal(res.sends, 1);
    assert.deepEqual((res.body as { data: unknown }).data, { sentBy: 'handler' });
  });
});

describe('getRouteContract', () => {
  it('returns the schemas and status a handler was built with', () => {
    const body = z.object({ a: z.string() });
    const response = z.object({ id: z.number() });
    const contract = getRouteContract(route({ body, response }, () => null, { status: 201 }));

    assert.equal(contract?.body, body);
    assert.equal(contract?.response, response);
    assert.equal(contract?.query, undefined);
    assert.equal(contract?.status, 201);
  });

  it('defaults the status to 200', () => {
    assert.equal(getRouteContract(route({}, () => null))?.status, 200);
  });

  it('knows nothing about a handler that route() did not build', () => {
    assert.equal(
      getRouteContract((_req, _res, next) => next()),
      undefined,
    );
  });

  it('is frozen, so the documented contract cannot drift from the enforced one', () => {
    assert.ok(Object.isFrozen(getRouteContract(route({}, () => null))));
  });
});
