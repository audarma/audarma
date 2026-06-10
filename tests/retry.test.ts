import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry, TimeoutError } from '../src/core/retry';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withRetry — no-retry default (backward compatibility)', () => {
  it('calls fn exactly once when no config is provided', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes undefined as the signal when no timeout is configured', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await withRetry(fn);
    expect(fn).toHaveBeenCalledWith(undefined);
  });

  it('does NOT retry by default — rejects on first failure, fn called once', async () => {
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats attempts <= 1 the same as the default (single call)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await withRetry(fn, { attempts: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not schedule any timers when no timeout/retry is configured', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fn = vi.fn().mockResolvedValue('ok');
    await withRetry(fn);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });
});

describe('withRetry — retry then succeed', () => {
  it('retries after a failure and resolves with the eventual success value', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100 });
    // Let the backoff timer fire.
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops retrying as soon as an attempt succeeds', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockResolvedValueOnce('ok')
      .mockResolvedValue('should-not-be-reached');

    const promise = withRetry(fn, { attempts: 5, baseDelayMs: 10 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withRetry — retry exhausted rethrows', () => {
  it('re-throws the LAST error after exhausting all attempts', async () => {
    vi.useFakeTimers();
    const last = new Error('final');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(last);

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 50 });
    // Attach a rejection handler before advancing timers to avoid unhandled
    // rejection noise while the backoff timers run.
    const assertion = expect(promise).rejects.toBe(last);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('withRetry — timeout aborts and is retried', () => {
  it('aborts a too-slow attempt and retries it', async () => {
    vi.useFakeTimers();

    const signals: Array<AbortSignal | undefined> = [];
    const fn = vi
      .fn()
      .mockImplementationOnce((signal: AbortSignal | undefined) => {
        signals.push(signal);
        // Never settles on its own -> must be killed by the timeout.
        return new Promise(() => {});
      })
      .mockImplementationOnce((signal: AbortSignal | undefined) => {
        signals.push(signal);
        return Promise.resolve('second-try');
      });

    const promise = withRetry(fn, { attempts: 2, baseDelayMs: 10, timeoutMs: 1000 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('second-try');
    expect(fn).toHaveBeenCalledTimes(2);

    // First attempt got a real signal that was aborted by the timeout.
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('rejects with a TimeoutError when a single attempt times out and no retries remain', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));

    const promise = withRetry(fn, { attempts: 1, timeoutMs: 500 });
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forwards the per-attempt signal to fn when timeoutMs is set', async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | undefined;
    const fn = vi.fn().mockImplementation((signal: AbortSignal | undefined) => {
      captured = signal;
      return Promise.resolve('done');
    });

    const promise = withRetry(fn, { timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('done');

    expect(captured).toBeInstanceOf(AbortSignal);
    // Successful attempt: signal must NOT be aborted.
    expect(captured?.aborted).toBe(false);
  });
});

describe('withRetry — exponential backoff', () => {
  it('waits baseDelayMs * 2^i between attempts', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('e0'))
      .mockRejectedValueOnce(new Error('e1'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');

    // Two backoff delays should have been scheduled: 100 (2^0) then 200 (2^1).
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(100);
    expect(delays).toContain(200);
  });

  it('does not delay before the first attempt', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue('immediate');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 1000 });
    // No timers needed for an immediately-successful first attempt.
    await expect(promise).resolves.toBe('immediate');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
