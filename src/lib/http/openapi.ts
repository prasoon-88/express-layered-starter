import type { RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import { getRouteContract } from './route.ts';

// Everything here is derived from the route table and the `route()` schemas, which are what the
// server enforces. Nothing is written by hand, so the document cannot drift from the code.

/** A mounted route. Structural, because lib/ may not import http/ where the manifest type lives. */
export type OpenApiRoute = {
  method: string;
  path: string;
  access: { strategy: string; roles?: readonly string[] };
  module?: string;
  controller: RequestHandler;
};

type JsonSchema = Record<string, unknown>;

type OpenApiOptions = {
  title: string;
  version: string;
  routes: readonly OpenApiRoute[];
};

const SECURITY_SCHEME = 'bearerAuth';

const errorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    code: { type: 'string' },
    message: { type: 'string' },
    requestId: { type: 'string' },
    details: {},
  },
  required: ['success', 'code', 'message', 'requestId'],
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const SUCCESS_DESCRIPTIONS: Readonly<Record<number, string>> = {
  [HTTP_STATUS.OK]: 'OK',
  [HTTP_STATUS.CREATED]: 'Created',
  [HTTP_STATUS.ACCEPTED]: 'Accepted',
};

// The same `{ success, message, data, requestId }` that buildSuccessBody sends.
const successEnvelope = (data: JsonSchema) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', const: true },
    message: { type: 'string' },
    data,
    requestId: { type: 'string' },
  },
  required: ['success', 'message', 'data', 'requestId'],
});

const capitalize = (word: string) =>
  concatenateStrings([word.charAt(0).toUpperCase(), word.slice(1)]);

// `POST /api/v1/auth/login` → `postApiV1AuthLogin`, `GET /users/:id` → `getUsersById`.
// Unique, because mount refuses two routes with the same method and path.
const operationId = (method: string, path: string) =>
  concatenateStrings([
    method.toLowerCase(),
    ...path
      .split('/')
      .map((segment) =>
        segment.startsWith(':')
          ? concatenateStrings(['By', capitalize(segment.slice(1))])
          : concatenateStrings(segment.split(/[^A-Za-z0-9]+/).map(capitalize)),
      ),
  ]);

const PARAM = /:([A-Za-z_$][A-Za-z0-9_$]*)/g;

export const buildOpenApiDocument = ({ title, version, routes }: OpenApiOptions) => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    const contract = getRouteContract(route.controller);

    // Input is documented as the client sends it, output as the server sends it: a
    // `.default()` makes a field optional for the client but always present in the reply.
    const toJson = (schema: ZodType, where: string, io: 'input' | 'output'): JsonSchema => {
      try {
        const json = z.toJSONSchema(schema, { io }) as JsonSchema;
        // The dialect is the document's (OpenAPI 3.1 is JSON Schema 2020-12), not each schema's.
        delete json.$schema;
        return json;
      } catch (err) {
        throw new Error(
          `${label}: the ${where} schema cannot be represented in OpenAPI (${err instanceof Error ? err.message : String(err)})`,
          { cause: err },
        );
      }
    };

    const properties = (schema: ZodType | undefined, where: string) => {
      if (!schema) return { props: {} as Record<string, JsonSchema>, required: [] as string[] };
      const json = toJson(schema, where, 'input');
      if (json.type !== 'object' || typeof json.properties !== 'object')
        throw new Error(`${label}: the ${where} schema must be an object, one field per parameter`);
      return {
        props: json.properties as Record<string, JsonSchema>,
        required: (json.required as string[] | undefined) ?? [],
      };
    };

    const params = properties(contract?.params, 'params');
    const query = properties(contract?.query, 'query');
    const parameters = [
      ...[...route.path.matchAll(PARAM)].map(([, name]) => ({
        name: name!,
        in: 'path',
        required: true,
        schema: params.props[name!] ?? { type: 'string' },
      })),
      ...Object.entries(query.props).map(([name, schema]) => ({
        name,
        in: 'query',
        required: query.required.includes(name),
        schema,
      })),
    ];

    const responses: Record<string, unknown> = {};
    if (contract) {
      const { status } = contract;
      responses[String(status)] =
        status === HTTP_STATUS.NO_CONTENT
          ? { description: 'No Content' }
          : {
              description: SUCCESS_DESCRIPTIONS[status] ?? 'Success',
              content: {
                'application/json': {
                  schema: successEnvelope(
                    contract.response ? toJson(contract.response, 'response', 'output') : {},
                  ),
                },
              },
            };
      if (contract.body || contract.query || contract.params)
        responses['400'] = errorResponse('The input failed validation; `details` lists each field');
    }

    const isPublic = route.access.strategy === 'public';
    const roles = route.access.roles;
    if (!isPublic) responses['401'] = errorResponse('Missing, invalid or expired access token');
    if (roles?.length) responses['403'] = errorResponse('Signed in without a permitted role');
    responses.default = errorResponse('Error');

    const operation = {
      operationId: operationId(route.method, route.path),
      ...(route.module && { tags: [route.module] }),
      ...(roles?.length && {
        description: `Requires one of the roles: ${concatenateStrings(roles, ', ')}.`,
      }),
      // An empty list overrides any default: this operation needs no credentials.
      security: isPublic ? [] : [{ [SECURITY_SCHEME]: [] }],
      ...(parameters.length && { parameters }),
      ...(contract?.body && {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: toJson(contract.body, 'body', 'input') } },
        },
      }),
      responses,
    };

    const openApiPath = route.path.replace(PARAM, '{$1}');
    (paths[openApiPath] ??= {})[route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: { title, version },
    // Relative: the paths resolve against whichever host served this document.
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        [SECURITY_SCHEME]: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: { Error: errorSchema },
    },
  };
};

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
