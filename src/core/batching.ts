/**
 * Pure rate-limit-aware batching utility for Audarma.
 *
 * Splits a translate pass into one or more worker calls according to a
 * {@link BatchingConfig}, with optional concurrency capping and a simple
 * minimum-interval rate limit between batch starts.
 *
 * BACKWARD COMPATIBILITY CONTRACT: when no config is provided (or
 * `maxBatchSize` is undefined), `runBatches` performs exactly ONE worker
 * call with the full item list — identical to calling `worker(items, 0)`
 * once. No batching, no concurrency machinery, no delays. This preserves the
 * current single-batch behavior byte-for-byte.
 */

/**
 * Split an array into contiguous chunks of at most `size` items.
 *
 * Order is preserved: `chunk(items, n).flat()` deep-equals `items`. A
 * non-positive or non-finite `size` is treated as "one chunk containing
 * everything", so callers can never produce zero-length or infinite chunks.
 *
 * @param items - The array to split
 * @param size - Maximum number of items per chunk
 * @returns An array of chunks, each preserving input order
 */
export function chunk<T>(items: T[], size: number): T[][] {
  // Guard against size <= 0, NaN, Infinity: fall back to a single chunk so we
  // never loop forever or emit empty chunks.
  if (!Number.isFinite(size) || size <= 0) {
    return items.length === 0 ? [] : [items.slice()];
  }
  const step = Math.floor(size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

/**
 * Configuration accepted by {@link runBatches}. Structurally compatible with
 * `BatchingConfig` from the public types, but defined locally so this module
 * stays dependency-free and tree-shakeable.
 */
export interface RunBatchesConfig {
  /** Maximum number of items per worker call. Default: all items in one batch. */
  maxBatchSize?: number;
  /** Maximum number of worker calls running concurrently. Default: 1 (sequential). */
  maxConcurrentBatches?: number;
  /** Minimum milliseconds between successive batch STARTS. Default: 0. */
  minBatchIntervalMs?: number;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a worker over items, optionally split into rate-limited, concurrency-
 * capped batches, and return the flattened results in input order.
 *
 * @param items - The full list of inputs to process
 * @param config - Batching policy. `undefined` (or `maxBatchSize` undefined)
 *   means a single batch — exactly one `worker(items, 0)` call.
 * @param worker - Processes one batch; receives the batch and its 0-based
 *   index. Must return one output per input, in order.
 * @param onBatchDone - OPTIONAL callback fired as each batch resolves (for
 *   progressive rendering). Receives the batch, its result, and its index.
 * @returns All worker outputs concatenated in input (batch) order
 */
export async function runBatches<TIn, TOut>(
  items: TIn[],
  config:
    | {
        maxBatchSize?: number;
        maxConcurrentBatches?: number;
        minBatchIntervalMs?: number;
      }
    | undefined,
  worker: (batch: TIn[], batchIndex: number) => Promise<TOut[]>,
  onBatchDone?: (batch: TIn[], result: TOut[], batchIndex: number) => void
): Promise<TOut[]> {
  const maxBatchSize = config?.maxBatchSize;

  // BACKWARD-COMPAT FAST PATH: no maxBatchSize -> a single batch with all
  // items, one worker call, identical to the original `worker(items, 0)`.
  // No chunking, no scheduling, no delays. Empty input still yields exactly
  // one call (matching the prior single-call behavior).
  if (maxBatchSize === undefined) {
    const result = await worker(items, 0);
    onBatchDone?.(items, result, 0);
    return result;
  }

  const batches = chunk(items, maxBatchSize);

  // Pre-size the results array so each batch can write its slice independently
  // regardless of completion order; flatten at the end to preserve input order.
  const batchResults: TOut[][] = new Array(batches.length);

  const rawConcurrency = config?.maxConcurrentBatches;
  // Default to sequential (1) when unset / non-positive. This matches the
  // BatchingConfig contract and is the safe default for a rate-limit feature:
  // chunking a large view should NOT fire every chunk at once. Callers opt into
  // parallelism by setting maxConcurrentBatches. Never exceed the batch count.
  const concurrency =
    rawConcurrency !== undefined && Number.isFinite(rawConcurrency) && rawConcurrency > 0
      ? Math.min(Math.floor(rawConcurrency), batches.length)
      : 1;

  const minInterval =
    config?.minBatchIntervalMs !== undefined &&
    Number.isFinite(config.minBatchIntervalMs) &&
    config.minBatchIntervalMs > 0
      ? config.minBatchIntervalMs
      : 0;

  // Timestamp of the most recent batch START, shared across workers so the
  // rate limit applies to the START of every batch, not just within one lane.
  let lastStart = 0;

  // A shared index cursor: each worker lane pulls the next batch to run.
  let next = 0;

  const runLane = async (): Promise<void> => {
    for (;;) {
      const index = next;
      if (index >= batches.length) {
        return;
      }
      next += 1;

      // Enforce the minimum interval between batch STARTS. Computed against the
      // last recorded start so concurrent lanes are throttled collectively.
      if (minInterval > 0) {
        const now = Date.now();
        const wait = lastStart + minInterval - now;
        if (wait > 0) {
          // Reserve this slot BEFORE awaiting so other lanes space off it too.
          lastStart = now + wait;
          await delay(wait);
        } else {
          lastStart = now;
        }
      }

      const batch = batches[index];
      const result = await worker(batch, index);
      batchResults[index] = result;
      onBatchDone?.(batch, result, index);
    }
  };

  const lanes: Array<Promise<void>> = [];
  for (let i = 0; i < concurrency; i += 1) {
    lanes.push(runLane());
  }
  await Promise.all(lanes);

  // Flatten in batch order -> overall input order.
  const flattened: TOut[] = [];
  for (const r of batchResults) {
    if (r) {
      for (const item of r) {
        flattened.push(item);
      }
    }
  }
  return flattened;
}
