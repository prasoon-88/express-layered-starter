// Paths are limited to static segments and whole-segment params. That subset is what the
// unreachable-route check can compare exactly; wildcards and optional groups would need a full
// model of Express's matcher, so they are refused instead of guessed at.
const STATIC_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const PARAM_SEGMENT = /^:[A-Za-z_$][A-Za-z0-9_$]*$/;
const DOTS_ONLY = /^\.+$/;

const isParam = (segment: string) => segment.startsWith(':');

const segmentsOf = (path: string) => (path === '/' ? [] : path.slice(1).split('/'));

export const pathProblem = (path: unknown): string | undefined => {
  if (typeof path !== 'string') return 'must be a string';
  if (!path.startsWith('/')) return 'must start with "/"';
  if (path === '/') return undefined;
  if (path.endsWith('/')) return 'must not end with a trailing "/"';

  for (const segment of segmentsOf(path)) {
    if (segment === '') return 'must not contain an empty segment';
    if (DOTS_ONLY.test(segment) || !(STATIC_SEGMENT.test(segment) || PARAM_SEGMENT.test(segment)))
      return `segment "${segment}" is not allowed: use letters, digits, "._~-", or a whole-segment ":param"`;
  }
  return undefined;
};

export const joinPaths = (base: string, path: string) => {
  const joined = [...segmentsOf(base || '/'), ...segmentsOf(path)];
  return joined.length ? `/${joined.join('/')}` : '/';
};

export const duplicateParam = (path: string) => {
  const seen = new Set<string>();
  for (const segment of segmentsOf(path).filter(isParam)) {
    const name = segment.slice(1);
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return undefined;
};

/** True when every request `later` could match is already answered by `earlier`. */
export const shadows = (earlier: string, later: string) => {
  const a = segmentsOf(earlier);
  const b = segmentsOf(later);
  return (
    a.length === b.length &&
    a.every((segment, i) => {
      const other = b[i] ?? '';
      if (isParam(segment)) return true;
      return !isParam(other) && segment.toLowerCase() === other.toLowerCase();
    })
  );
};
