import httpConverter from './http.converter.js';
import jwtConverter from './jwt.converter.js';

const converters = [httpConverter, jwtConverter];

export const convertError = (err) => {
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
