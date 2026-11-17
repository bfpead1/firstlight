import { decryptSecret, encryptSecret } from "../lib/secrets.js";

/**
 * Merges freshly issued Google tokens into stored ones. Google only returns a refresh
 * token on the first consent (or when re-prompted), so a missing field in `incoming`
 * must never erase the one we already have.
 */
export function mergeTokens(existing = {}, incoming = {}) {
  const defined = Object.fromEntries(
    Object.entries(incoming).filter(([, v]) => v !== undefined && v !== null),
  );
  return { ...existing, ...defined };
}

/** Encrypts a token object for storage: { sealed: "v1...." }. */
export function sealTokens(tokens) {
  return { sealed: encryptSecret(JSON.stringify(tokens)) };
}

/**
 * Reads stored tokens. Rows written before encryption hold the plain object and are
 * re-sealed on the next write. Undecryptable tokens (SESSION_SECRET changed) come back
 * empty, which sends the user through Google's consent screen again.
 */
export function openTokens(stored) {
  if (!stored?.sealed) return stored ?? {};
  const json = decryptSecret(stored.sealed);
  return json ? JSON.parse(json) : {};
}
