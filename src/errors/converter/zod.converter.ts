import { ZodError } from 'zod';
import { BadRequestError } from '#errors';
import { ERROR_CODES } from '#constants/error/errorCodes.constant';

// One entry per failing field. An unrecognized-keys issue sits on the parent object,
// so it is expanded into one entry per extra key, with that key in the path.
const formatZodError = (err: ZodError) =>
  err.issues.flatMap((i) =>
    i.code === 'unrecognized_keys'
      ? i.keys.map((k) => ({
          path: [...i.path, k].map(String).join('.'),
          message: 'Unrecognized field',
        }))
      : [{ path: i.path.map(String).join('.'), message: i.message }],
  );

export const zodConverter = (err: unknown) => {
  if (err instanceof ZodError)
    return new BadRequestError('Validation Failed', ERROR_CODES.BAD_REQUEST, formatZodError(err));
  return null;
};
