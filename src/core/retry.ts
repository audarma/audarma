/**
 * Pure retry + per-attempt timeout utility for Audarma.
 *
 * This module is intentionally dependency-free and side-effect-free beyond the
 * timers it schedules, so it can be unit-tested in isolation (including with
 * `vi.useFakeTimers`). It does NOT know anything about translation; it simply
 * runs an async function with optional retry, exponential backoff, and a
 * per-attempt abort timeout.
 *
 * BACKWARD COMPATIBILITY: with no options (or `attempts <= 1` and no
 * `timeoutMs`), the function is called exactly once with `undefined` as the
 * signal and the behavior is byte-for-byte identical to calling `fn(undefined)`
 * directly — no extra timers, no AbortController, no wrapping.
 */

/**
 * Options controlling retry and per-attempt timeout behavior.
 *
 * Mirrors {@link RetryConfig} from `../types`. All fields are optional and the
 * defaults preserve the original no-retry behavior.
 */
export interface WithRetryOptions {
  /**
   * Total number of attempts (including the first). Default 1 (NO retry).
   * Values < 1 are treated as 1.
   */
  attempts?: number;

  /**
   * Base delay in milliseconds used for exponential backoff between retries.
   * The delay before retry attempt `i` (0-indexed by failed-attempt) is
   * `baseDelayMs * 2^i`. Default 300. Only relevant when `attempts` > 1.
   */
  baseDelayMs?: number;

  /**
   * Per-attempt timeout in milliseconds. When set, each attempt receives its
   * own AbortController; if the attempt does not settle within `timeoutMs` the
   * signal is aborted and the attempt is rejected (counting as a failed
   * attempt eligible for retry). Default: undefined (no timeout).
   */
  timeoutMs?: number;
}

const DEFAULT_ATTEMPTS = 1;
const DEFAULT_BASE_DELAY_MS = 300;

/**
 * Resolve after `ms` milliseconds using a `setTimeout`-based delay.
 *
 * Kept as a tiny standalone helper so timing logic stays compatible with
 * `vi.useFakeTimers()` (and with real timers). Exported for direct testing.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves once the timer fires.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Error thrown when a single attempt exceeds its `timeoutMs` budget. Its
 * presence lets callers (and tests) distinguish a timeout from an error thrown
 * by `fn` itself.
 */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Run a single attempt with an optional per-attempt timeout.
 *
 * When `timeoutMs` is set, an AbortController is created, its signal is passed
 * to `fn`, and a timer races the work. If the timer wins, the controller is
 * aborted and the attempt rejects with a {@link TimeoutError}. The timer is
 * always cleared once the attempt settles to avoid leaking timers.
 *
 * When `timeoutMs` is undefined, `fn` is invoked with `undefined` and awaited
 * directly — no controller, no timer.
 */
async function runAttempt<T>(
  fn: (signal: AbortSignal | undefined) => Promise<T>,
  timeoutMs: number | undefined
): Promise<T> {
  // No timeout configured -> preserve original behavior exactly.
  if (timeoutMs === undefined) {
    return fn(undefined);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    // Whichever settles first wins. If fn rejects/resolves first we cancel the
    // timer in `finally`; if the timer fires first we abort and reject.
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Run an async function with optional retry, exponential backoff, and a
 * per-attempt timeout.
 *
 * Behavior:
 * - `attempts` defaults to 1, so by default `fn` is called exactly once and the
 *   only optional behavior is the per-attempt timeout.
 * - On a thrown error (including a timeout), the call is retried up to
 *   `attempts - 1` additional times. Before each retry it waits
 *   `baseDelayMs * 2^(failedAttemptIndex)` milliseconds (exponential backoff).
 * - If every attempt fails, the last error is re-thrown.
 * - When `timeoutMs` is set, each attempt gets its own AbortController and the
 *   per-attempt signal is forwarded to `fn`, so callers can pass it to
 *   `fetch`/LLM SDKs. A timeout counts as a failed attempt eligible for retry.
 *
 * @param fn - The work to run. Receives the per-attempt `AbortSignal` (or
 *   `undefined` when no timeout is configured).
 * @param config - Optional retry/timeout configuration.
 * @returns The resolved value of the first successful attempt.
 * @throws The error from the final failed attempt when all attempts fail.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal | undefined) => Promise<T>,
  config?: WithRetryOptions
): Promise<T> {
  const attempts = Math.max(1, config?.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = config?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = config?.timeoutMs;

  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex++) {
    try {
      return await runAttempt(fn, timeoutMs);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attemptIndex === attempts - 1;
      if (isLastAttempt) {
        break;
      }

      // Exponential backoff before the next attempt: base * 2^attemptIndex.
      const backoff = baseDelayMs * 2 ** attemptIndex;
      if (backoff > 0) {
        await delay(backoff);
      }
    }
  }

  throw lastError;
}
