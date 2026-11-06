import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import { z } from 'zod';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { route } = await import('./route.lib.ts');
const { buildOpenApiDocument } = await import('./openapi.lib.ts');

type Route = Parameters<typeof buildOpenApiDocument>[0]['routes'][number];

const open = { strategy: 'public', reason: 'test' } as const;
const plain: RequestHandler = (_req, res) => {
  res.end();
};

const build = (routes: Route[]) => buildOpenApiDocument({ title: 'svc', version: '1.2.3', routes });

type Operation = {
  operationId: string;
  tags?: string[];
  description?: string;
  security: unknown[];
  parameters?: { name: string; in: string; required: boolean; schema: unknown }[];
  requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: unknown }> }>;
};

const op = (doc: ReturnType<typeof build>, method: string, path: string) =>
  (doc.paths as Record<string, Record<string, Operation>>)[path]![method]!;

describe('buildOpenApiDocument', () => {
  it('builds an OpenAPI 3.1 document with bearer auth and the error envelope', () => {
    const doc = build([]);

    assert.equal(doc.openapi, '3.1.0');
    assert.deepEqual(doc.info, { title: 'svc', version: '1.2.3' });
    assert.deepEqual(doc.servers, [{ url: '/' }]);
    assert.deepEqual(doc.components.securitySchemes, {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
    assert.deepEqual(doc.components.schemas.Error.required, [
      'success',
      'code',
      'message',
      'requestId',
    ]);
    assert.deepEqual(doc.paths, {});
  });

  it('marks a public route as needing no credentials', () => {
    const doc = build([{ method: 'GET', path: '/a', access: open, controller: plain }]);

    assert.deepEqual(op(doc, 'get', '/a').security, []);
    assert.equal(op(doc, 'get', '/a').responses['401'], undefined);
  });

  it('requires the bearer token on an authenticated route and documents its 401', () => {
    const doc = build([
      { method: 'GET', path: '/me', access: { strategy: 'authenticated' }, controller: plain },
    ]);

    assert.deepEqual(op(doc, 'get', '/me').security, [{ bearerAuth: [] }]);
    assert.ok(op(doc, 'get', '/me').responses['401']);
    assert.equal(op(doc, 'get', '/me').responses['403'], undefined);
  });

  it('names the roles of a roles route and documents its 401 and 403', () => {
    const doc = build([
      {
        method: 'DELETE',
        path: '/users/:id',
        access: { strategy: 'roles', roles: ['ADMIN'] },
        controller: plain,
      },
    ]);
    const operation = op(doc, 'delete', '/users/{id}');

    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    assert.match(operation.description ?? '', /ADMIN/);
    assert.ok(operation.responses['401']);
    assert.ok(operation.responses['403']);
  });

  it('turns :params into {params}, typed from the params schema when there is one', () => {
    const controller = route({ params: z.object({ id: z.uuid() }) }, () => null);
    const doc = build([
      { method: 'GET', path: '/users/:id/posts/:postId', access: open, controller },
    ]);
    const params = op(doc, 'get', '/users/{id}/posts/{postId}').parameters;

    assert.deepEqual(
      params?.map((p) => [p.name, p.in, p.required]),
      [
        ['id', 'path', true],
        ['postId', 'path', true],
      ],
    );
    assert.equal((params?.[0]?.schema as { format?: string }).format, 'uuid');
    assert.deepEqual(params?.[1]?.schema, { type: 'string' });
  });

  it('lists query fields as parameters; one with a default is optional', () => {
    const controller = route(
      {
        query: z.object({
          page: z.coerce.number().int().min(1).default(1),
          q: z.string(),
        }),
      },
      () => null,
    );
    const doc = build([{ method: 'GET', path: '/search', access: open, controller }]);
    const params = op(doc, 'get', '/search').parameters;

    assert.deepEqual(
      params?.map((p) => [p.name, p.in, p.required]),
      [
        ['page', 'query', false],
        ['q', 'query', true],
      ],
    );
  });

  it('documents the body as the client sends it, and a 400 for invalid input', () => {
    const controller = route(
      { body: z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email()) }) },
      () => null,
    );
    const doc = build([{ method: 'POST', path: '/x', access: open, controller }]);
    const operation = op(doc, 'post', '/x');
    const schema = operation.requestBody?.content['application/json']?.schema as Record<
      string,
      unknown
    >;

    assert.equal(operation.requestBody?.required, true);
    assert.equal(schema.additionalProperties, false);
    assert.equal('$schema' in schema, false);
    assert.ok(operation.responses['400']);
  });

  it('wraps the response schema in the success envelope, under the route status', () => {
    const controller = route({ response: z.object({ id: z.string() }) }, () => ({ id: 'a' }), {
      status: 201,
    });
    const doc = build([{ method: 'POST', path: '/x', access: open, controller }]);
    const created = op(doc, 'post', '/x').responses['201'];
    const envelope = created?.content?.['application/json']?.schema as {
      properties: Record<string, unknown>;
      required: string[];
    };

    assert.equal(created?.description, 'Created');
    assert.deepEqual(envelope.properties.success, { type: 'boolean', const: true });
    assert.deepEqual((envelope.properties.data as { required: string[] }).required, ['id']);
    assert.deepEqual(envelope.required, ['success', 'message', 'data', 'requestId']);
    assert.equal(op(doc, 'post', '/x').responses['200'], undefined);
  });

  it('documents a 204 with no body', () => {
    const controller = route({}, () => undefined, { status: 204 });
    const doc = build([{ method: 'POST', path: '/x', access: open, controller }]);

    assert.deepEqual(op(doc, 'post', '/x').responses['204'], { description: 'No Content' });
  });

  it('documents a handler not built with route() by its errors only, since nothing else is known', () => {
    const doc = build([{ method: 'GET', path: '/raw', access: open, controller: plain }]);

    assert.deepEqual(Object.keys(op(doc, 'get', '/raw').responses), ['default']);
  });

  it('gives each operation a stable id and its module as the tag', () => {
    const doc = build([
      {
        method: 'POST',
        path: '/api/v1/auth/login',
        access: open,
        controller: plain,
        module: 'auth',
      },
      { method: 'GET', path: '/api/v1/users/:id', access: open, controller: plain },
    ]);

    assert.equal(op(doc, 'post', '/api/v1/auth/login').operationId, 'postApiV1AuthLogin');
    assert.deepEqual(op(doc, 'post', '/api/v1/auth/login').tags, ['auth']);
    assert.equal(op(doc, 'get', '/api/v1/users/{id}').operationId, 'getApiV1UsersById');
    assert.equal(op(doc, 'get', '/api/v1/users/{id}').tags, undefined);
  });

  it('groups methods on the same path under one path item', () => {
    const doc = build([
      { method: 'GET', path: '/x', access: open, controller: plain },
      { method: 'PUT', path: '/x', access: open, controller: plain },
    ]);

    assert.deepEqual(Object.keys((doc.paths as Record<string, object>)['/x']!), ['get', 'put']);
  });

  it('names the route and the schema it cannot represent', () => {
    const controller = route({ response: z.object({ at: z.date() }) }, () => null);

    assert.throws(
      () => build([{ method: 'GET', path: '/when', access: open, controller }]),
      /GET \/when: the response schema cannot be represented in OpenAPI/,
    );
  });

  it('refuses a query schema that is not an object, since each field becomes a parameter', () => {
    const controller = route({ query: z.string() }, () => null);

    assert.throws(
      () => build([{ method: 'GET', path: '/q', access: open, controller }]),
      /GET \/q: the query schema must be an object/,
    );
  });
});
