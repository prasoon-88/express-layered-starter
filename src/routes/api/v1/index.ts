import { defineGroup, type RouteNode } from '#http/routes';

export const apiV1Routes = (modules: readonly RouteNode[]) => defineGroup('/v1', modules);
