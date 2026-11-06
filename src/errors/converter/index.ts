import { httpConverter } from './http.converter.ts';
import { jwtConverter } from './jwt.converter.ts';
import { zodConverter } from './zod.converter.ts';

const converters = [zodConverter, httpConverter, jwtConverter];

export const convertError = (err: unknown) => {
  for (const converter of converters) {
    try {
      const converted = converter(err);
      if (converted) return converted;
    } catch {
      // a converter threw on this error shape — skip it and try the next
    }
  }

  return null;
};
