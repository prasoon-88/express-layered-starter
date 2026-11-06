export interface NewRefreshToken {
  id: string;
  userId: string;
  /** Every token rotated from one login shares the family; reuse or logout revokes all of it. */
  familyId: string;
  /** sha256 of the secret half. The secret itself is never stored. */
  hash: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export interface StoredRefreshToken extends NewRefreshToken {
  usedAt: number | null;
  /** When its family was revoked. */
  revokedAt: number | null;
}

// In-memory until a database branch replaces this file. A database keeps the same four calls:
// - markUsed is `UPDATE tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`, checking the row count.
// - Revocation lives on the family row, not on each token, so a token written into a family
//   after it was revoked (a rotation racing a reuse) is revoked too.
export const createRefreshTokenRepository = () => {
  const byId = new Map<string, Omit<StoredRefreshToken, 'revokedAt'>>();
  const revokedFamilies = new Map<string, number>();

  // Without a database TTL index, expired rows are dropped whenever a new one is written.
  const sweep = (now: number) => {
    for (const [id, token] of byId) if (token.expiresAt <= now) byId.delete(id);

    const liveFamilies = new Set([...byId.values()].map((t) => t.familyId));
    for (const familyId of revokedFamilies.keys())
      if (!liveFamilies.has(familyId)) revokedFamilies.delete(familyId);
  };

  const create = (data: NewRefreshToken, now: number): Promise<void> => {
    sweep(now);
    byId.set(data.id, { ...data, usedAt: null });
    return Promise.resolve();
  };

  // A copy, so a caller cannot change the stored row by editing what it got back.
  const findById = (id: string): Promise<StoredRefreshToken | undefined> => {
    const token = byId.get(id);
    return Promise.resolve(
      token && { ...token, revokedAt: revokedFamilies.get(token.familyId) ?? null },
    );
  };

  /** True for exactly one caller: the first to use the token. Check and write are one step. */
  const markUsed = (id: string, now: number): Promise<boolean> => {
    const token = byId.get(id);
    if (!token || token.usedAt !== null) return Promise.resolve(false);
    token.usedAt = now;
    return Promise.resolve(true);
  };

  const revokeFamily = (familyId: string, now: number): Promise<void> => {
    if (!revokedFamilies.has(familyId)) revokedFamilies.set(familyId, now);
    return Promise.resolve();
  };

  return { create, findById, markUsed, revokeFamily };
};

export type RefreshTokenRepository = ReturnType<typeof createRefreshTokenRepository>;
