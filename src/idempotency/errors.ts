export class UnknownPolicyError extends Error {
  constructor(policyName: string) {
    super(`Unknown idempotency policy "${policyName}"`);
    this.name = 'UnknownPolicyError';
  }
}
