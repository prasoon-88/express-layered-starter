import type { Request, RequestHandler } from 'express';
import type { UserRole } from '#constants/user.constant';
import { ForbiddenError, UnauthorizedError } from '#errors';

/** Lets through a caller whose role is listed. Mount it after the middleware that sets `req.user`. */
export const authorize = (roles: readonly UserRole[]): RequestHandler => {
  if (roles.length === 0) throw new Error('authorize() needs at least one role');
  const allowed = new Set(roles);

  return (req, _res, next) => {
    // Typed as always present for protected handlers; at runtime it is only there once
    // authentication ran, so a missing user here means nobody was authenticated.
    const user = req.user as Request['user'] | undefined;
    if (!user) return next(new UnauthorizedError());
    if (!allowed.has(user.role)) return next(new ForbiddenError());
    next();
  };
};
