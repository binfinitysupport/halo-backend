// Slows down password guessing. After MAX_FAILED_ATTEMPTS wrong passwords from the same address,
// that address is locked out for LOCKOUT_MINUTES. Counts are kept in memory, so they reset on restart.
const MILLISECONDS_PER_MINUTE = 60 * 1000;

export function createLoginLimiter({ maxFailedAttempts = 5, lockoutMinutes = 15 } = {}) {
  const lockoutMs = lockoutMinutes * MILLISECONDS_PER_MINUTE;
  // Key: client address. Value: { count, firstFailureAt }.
  const failuresByAddress = new Map();

  // How many milliseconds this address is still locked out for (0 = not locked).
  function lockedForMs(address) {
    const record = failuresByAddress.get(address);
    if (!record) return 0;

    const windowEndsAt = record.firstFailureAt + lockoutMs;
    if (Date.now() > windowEndsAt) {
      failuresByAddress.delete(address); // the window has passed: forget the old failures
      return 0;
    }
    return record.count >= maxFailedAttempts ? windowEndsAt - Date.now() : 0;
  }

  function recordFailure(address) {
    const record = failuresByAddress.get(address) || { count: 0, firstFailureAt: Date.now() };
    record.count += 1;
    failuresByAddress.set(address, record);
  }

  function clear(address) {
    failuresByAddress.delete(address);
  }

  return { lockedForMs, recordFailure, clear };
}
