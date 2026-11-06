// Both are thrown while the app is being built, never while serving a request:
// a wiring mistake stops the boot instead of surfacing as a 500 later.

export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

export class RouteDefinitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RouteDefinitionError';
  }
}
