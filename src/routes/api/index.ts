import { json } from 'express';
import { defineGroup, type RouteNode } from '#http/routes';

// JSON parsing is mounted here only: the web routes render forms rather than consume JSON.
export const apiRoutes = (versions: readonly RouteNode[]) =>
  defineGroup('/api', versions, { use: [json()] });
