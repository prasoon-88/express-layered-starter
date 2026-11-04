import { createHash } from 'node:crypto';
import { type Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { concatenateStrings } from '#utils/concateStrings';

export type KeyContext = {
  ipv6Subnet: number;
};

export type KeyFn<T = string | undefined> = (req: Request, ctx: KeyContext) => T;

const hash = (v: string) => createHash('sha256').update(v).digest('base64url').slice(0, 22);

const ip: KeyFn<string> = (req, { ipv6Subnet }) =>
  concatenateStrings(
    ['ip', ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? 'unknown', ipv6Subnet)],
    ':',
  );

const user: KeyFn = (req) =>
  req.user.id ? concatenateStrings(['user', req?.user?.id], ':') : undefined;

const header =
  (name: string): KeyFn =>
  (req) => {
    const v = req.header(name);
    if (v) return concatenateStrings(['h', name, hash(v)], ':');
    return undefined;
  };

const body =
  (field: string): KeyFn =>
  (req) => {
    const v = (req.body as Record<string, unknown> | undefined)?.[field];
    return typeof v === 'string' && v ? concatenateStrings(['b', field, hash(v)], ':') : undefined;
  };

const first =
  (...fns: KeyFn[]): KeyFn =>
  (req, ctx) => {
    for (const fn of fns) {
      const k = fn(req, ctx);
      if (k) return k;
    }
    return undefined;
  };

export const keys = { ip, user, header, body, first };
