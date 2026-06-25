/**
 * Poll an async predicate until it returns true or the deadline passes.
 *
 * One timeout channel: on expiry it throws — using `onTimeout()` for the
 * message if given, otherwise the last error the predicate threw. Callers
 * therefore never need their own "if (!ok) throw" block.
 *
 * Named `pollUntil` (not `waitFor`) to avoid colliding with the well-known
 * `@testing-library` `waitFor`, whose semantics differ.
 */
export async function pollUntil(
  predicate: () => Promise<boolean>,
  options: {
    timeoutMs: number;
    intervalMs?: number;
    onTimeout?: () => string;
  }
): Promise<void> {
  const { timeoutMs, intervalMs = 2000, onTimeout } = options;
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (e) {
      // not ready yet — keep polling, but remember why for the timeout message
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const detail = onTimeout
    ? onTimeout()
    : lastErr !== undefined
      ? `last error: ${String(lastErr)}`
      : "predicate never satisfied";
  throw new Error(`pollUntil timed out after ${timeoutMs}ms; ${detail}`);
}
