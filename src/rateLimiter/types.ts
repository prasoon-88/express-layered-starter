import z from 'zod';

export const policySchema = z.object({
  points: z.number().int().min(1),
  durationS: z.number().int().min(1),
  blockDurationS: z.number().int().min(1).optional(),
});

export type Policy = z.infer<typeof policySchema>;

export const decisionDataSchema = z.object({
  allowed: z.boolean(),
  limit: z.number().int(),
  remaining: z.number().int(),
  windowS: z.number().int(),
  resetMs: z.number(),
  // The store could not be reached, so no limit was checked; `allowed` comes from onStoreError.
  storeError: z.boolean(),
});

type DecisionData = z.infer<typeof decisionDataSchema>;

export type Decision = DecisionData & {
  refund: () => Promise<void>;
};
