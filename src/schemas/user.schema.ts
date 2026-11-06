import { z } from 'zod';
import REGEX from '#constants/regex.constant';
import { USER_ROLES } from '#constants/user.constant';

// The authenticated user that every non-public route sees as `req.user`.
// Generic on purpose: identity and role only, nothing tied to a database model,
// so it stays the same on every database branch. Add fields here, never on req.user directly.
// `z.object` strips unknown keys, so parsing a decoded JWT keeps `iat`/`exp` out of req.user.
export const authUserSchema = z.object({
  id: z.string().regex(REGEX.SAFE_ID, 'Invalid id'),
  email: z.email(),
  role: z.enum(USER_ROLES),
});

export type AuthUser = z.infer<typeof authUserSchema>;

// A password being set: at signup and on a change. Capped because hashing cost grows with input,
// and an uncapped field is a cheap way to burn CPU.
export const newPasswordSchema = z.string().min(8).max(128);
