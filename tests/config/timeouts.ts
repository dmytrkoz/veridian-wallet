/**
 * E2E timeout scaling. CI's shared emulators are slower than a local machine, so
 * UI waits need more headroom there. One knob scales every e2e timeout: the base
 * values passed to `t()` are the LOCAL numbers; on CI they are multiplied by
 * CI_TIMEOUT_FACTOR. Local runs (no CI env) are unchanged.
 *
 * Tune per-workflow via CI_TIMEOUT_FACTOR (e.g. raise it if a slow runner still
 * flakes). Starts at 2× on CI — conservative; bump if needed.
 *
 * Scope: e2e/wdio only. Integration timeouts run headless in Node against
 * docker-KERIA (same speed everywhere) and are deliberately NOT scaled — ×N there
 * would exceed jest's testTimeout.
 */
// Guard against a garbage/empty env value: Number("") === 0 and Number("x") === NaN
// would otherwise zero/NaN every timeout. Only a finite positive override wins.
const _envFactor = Number(process.env.CI_TIMEOUT_FACTOR);
export const CI_TIMEOUT_FACTOR =
  Number.isFinite(_envFactor) && _envFactor > 0
    ? _envFactor
    : process.env.CI
      ? 2
      : 1;

/** Scale a base (local) e2e timeout for the current environment. */
export const t = (baseMs: number): number =>
  Math.round(baseMs * CI_TIMEOUT_FACTOR);
