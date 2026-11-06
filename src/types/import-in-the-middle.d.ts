// import-in-the-middle ships register-hooks.d.ts beside register-hooks.mjs and has no "exports"
// map, so TypeScript (nodenext looks for register-hooks.d.mts) never finds it. This mirrors that
// file; check it against the package's own register-hooks.d.ts when upgrading.
declare module 'import-in-the-middle/register-hooks.mjs' {
  export type RegisterHooksOptions = {
    include?: Array<string | RegExp>;
    exclude?: Array<string | RegExp>;
    disableCjsSourceStripping?: boolean;
  };

  /** Registers the loader through module.registerHooks(); throws where that is unsupported. */
  export function register(options?: RegisterHooksOptions): void;

  export function supportsSyncHooks(): boolean;
}
