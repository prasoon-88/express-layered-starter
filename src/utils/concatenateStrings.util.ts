export const concatenateStrings = (
  parts: ReadonlyArray<string | number | null | undefined>,
  separator = '',
): string => parts.filter((p) => p !== null && p !== undefined && p !== '').join(separator);
