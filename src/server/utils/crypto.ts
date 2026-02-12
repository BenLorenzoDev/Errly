// ============================================================================
// Errly — Crypto Utilities
// SHA-256 hash-then-timingSafeEqual for constant-time secret comparison
// ============================================================================

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compute the SHA-256 hash of a string and return the raw 32-byte Buffer.
 */
export function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

/**
 * Compare two strings in constant time.
 *
 * Both inputs are first hashed with SHA-256 to produce fixed-length 32-byte
 * digests, then compared with crypto.timingSafeEqual(). This approach:
 *   1. Guarantees equal-length buffers regardless of input lengths, preventing
 *      the RangeError that timingSafeEqual throws on unequal-length buffers.
 *   2. Prevents timing side-channel attacks on password / token comparisons.
 */
export function safeCompare(a: string, b: string): boolean {
  const hashA = sha256(a);
  const hashB = sha256(b);
  return timingSafeEqual(hashA, hashB);
}

/**
 * Compute the SHA-256 hex digest of a string.
 * Used for hashing session tokens before storage.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
