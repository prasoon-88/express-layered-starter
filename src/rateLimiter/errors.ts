export class UnknownPolicyError extends Error {
  constructor(policyName: string) {
    super(`Unknown rate limit policy "${policyName}"`);
    this.name = 'UnknownPolicyError';
  }
}
