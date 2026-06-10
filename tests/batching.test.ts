import { describe, it, expect, vi } from 'vitest';
import { chunk, runBatches } from '../src/core/batching';

describe('chunk', () => {
  it('splits into contiguous chunks of the given size, preserving order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('flattening a chunked array reproduces the input exactly', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(chunk(items, 3).flat()).toEqual(items);
  });

  it('returns a single chunk when size >= length', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('returns [] for an empty input', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it('falls back to a single chunk for non-positive sizes', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3], -4)).toEqual([[1, 2, 3]]);
  });
});

describe('runBatches — backward-compatible single-batch default', () => {
  it('makes exactly one worker call with all items when config is undefined', async () => {
    const items = ['a', 'b', 'c'];
    const worker = vi.fn(async (batch: string[]) => batch.map((x) => x.toUpperCase()));

    const result = await runBatches(items, undefined, worker);

    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith(items, 0);
    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('is identical to a single worker(items, 0) call when maxBatchSize is undefined', async () => {
    const items = [1, 2, 3, 4];
    const worker = vi.fn(async (batch: number[]) => batch.map((x) => x * 10));

    // maxBatchSize undefined even though other fields are set -> still one call.
    const result = await runBatches(
      items,
      { maxConcurrentBatches: 4, minBatchIntervalMs: 100 },
      worker
    );

    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith(items, 0);
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it('still makes exactly one worker call for empty input (no maxBatchSize)', async () => {
    const worker = vi.fn(async (batch: number[]) => batch);
    const result = await runBatches([], undefined, worker);

    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith([], 0);
    expect(result).toEqual([]);
  });
});

describe('runBatches — chunking by maxBatchSize', () => {
  it('splits items into batches of maxBatchSize and calls the worker per batch', async () => {
    const items = [1, 2, 3, 4, 5];
    const seen: Array<{ batch: number[]; index: number }> = [];
    const worker = vi.fn(async (batch: number[], index: number) => {
      seen.push({ batch, index });
      return batch.map((x) => x + 100);
    });

    const result = await runBatches(items, { maxBatchSize: 2 }, worker);

    expect(worker).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([
      { batch: [1, 2], index: 0 },
      { batch: [3, 4], index: 1 },
      { batch: [5], index: 2 },
    ]);
    expect(result).toEqual([101, 102, 103, 104, 105]);
  });
});

describe('runBatches — concurrency cap', () => {
  it('never runs more than maxConcurrentBatches workers at once', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];

    const worker = vi.fn(async (batch: number[]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Block until explicitly released so we can observe concurrent peak.
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return batch;
    });

    // 10 items, size 1 -> 10 batches, capped at 3 concurrent.
    const promise = runBatches(items, { maxBatchSize: 1, maxConcurrentBatches: 3 }, worker);

    // Release workers in waves until everything finishes.
    while (release.length > 0 || active > 0) {
      const pending = release.splice(0, release.length);
      pending.forEach((fn) => fn());
      // Let microtasks settle so the next wave of lanes can start.
      await Promise.resolve();
      await Promise.resolve();
    }

    const result = await promise;

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1); // confirms real concurrency happened
    expect(result).toEqual(items);
  });

  it('runs batches sequentially by default when no cap is set', async () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];

    const worker = vi.fn(async (batch: number[]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return batch;
    });

    const promise = runBatches(items, { maxBatchSize: 1 }, worker);

    while (release.length > 0 || active > 0) {
      const pending = release.splice(0, release.length);
      pending.forEach((fn) => fn());
      await Promise.resolve();
      await Promise.resolve();
    }
    await promise;

    // Default concurrency is 1 (sequential) — the safe default for a
    // rate-limit feature. Parallelism is opt-in via maxConcurrentBatches.
    expect(maxActive).toBe(1);
  });
});

describe('runBatches — onBatchDone', () => {
  it('fires once per batch with the batch, its result, and its index', async () => {
    const items = [1, 2, 3, 4, 5];
    const worker = async (batch: number[]) => batch.map((x) => x * 2);
    const calls: Array<{ batch: number[]; result: number[]; index: number }> = [];

    await runBatches(items, { maxBatchSize: 2 }, worker, (batch, result, index) => {
      calls.push({ batch, result, index });
    });

    expect(calls).toHaveLength(3);
    // Sort by index since concurrency may resolve out of order.
    calls.sort((a, b) => a.index - b.index);
    expect(calls).toEqual([
      { batch: [1, 2], result: [2, 4], index: 0 },
      { batch: [3, 4], result: [6, 8], index: 1 },
      { batch: [5], result: [10], index: 2 },
    ]);
  });

  it('fires once on the single-batch default path too', async () => {
    const items = ['x', 'y'];
    const onBatchDone = vi.fn();
    await runBatches(items, undefined, async (b) => b, onBatchDone);

    expect(onBatchDone).toHaveBeenCalledTimes(1);
    expect(onBatchDone).toHaveBeenCalledWith(items, items, 0);
  });
});

describe('runBatches — result ordering', () => {
  it('preserves input order even when later batches resolve first', async () => {
    const items = [1, 2, 3, 4, 5, 6];
    // Make EARLIER batches take longer so they resolve LAST.
    const worker = async (batch: number[], index: number) => {
      const delayMs = (3 - index) * 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return batch.map((x) => x * 10);
    };

    const result = await runBatches(items, { maxBatchSize: 2 }, worker);

    expect(result).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe('runBatches — minBatchIntervalMs', () => {
  it('spaces successive batch starts by at least the configured interval', async () => {
    const items = [1, 2, 3];
    const starts: number[] = [];
    const worker = async (batch: number[]) => {
      starts.push(Date.now());
      return batch;
    };

    // Serialize (concurrency 1) so interval is observable on starts.
    await runBatches(
      items,
      { maxBatchSize: 1, maxConcurrentBatches: 1, minBatchIntervalMs: 30 },
      worker
    );

    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(25);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(25);
  });
});
