import type { RequestHandler } from 'express';
import { buildOpenApiDocument, type OpenApiDocument, type OpenApiRoute } from '#lib/http/openapi';

type DocsControllerDeps = {
  routeTable: { all: () => readonly OpenApiRoute[] };
  title: string;
  version: string;
};

const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');

export const createDocsController = ({ routeTable, title, version }: DocsControllerDeps) => {
  // Built on the first request, not at construction: the route table is only complete once
  // mounting finished. Routes never change after that, so one build serves every request.
  let document: OpenApiDocument | undefined;

  // The bare document, not the success envelope: OpenAPI tools read it as is.
  const openApi: RequestHandler = (_req, res) => {
    document ??= buildOpenApiDocument({
      title,
      version,
      routes: routeTable.all().filter((r) => isApiPath(r.path)),
    });
    res.json(document);
  };

  return { openApi };
};

export type DocsController = ReturnType<typeof createDocsController>;
