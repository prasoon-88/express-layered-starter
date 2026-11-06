import type { Request } from 'express';
import { concatenateStrings } from '#utils/concatenateStrings.util';

export type ScopeFn = (req: Request) => string;

const user: ScopeFn = (req) =>
  req.user?.id
    ? concatenateStrings(['u', req.user.id], ':')
    : concatenateStrings(['ip', req.ip ?? 'unknown'], ':');

const ip: ScopeFn = (req) => concatenateStrings(['ip', req.ip ?? 'unknown'], ':');

export const scopes = { user, ip };
