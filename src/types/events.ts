/**
 * Observability events for Audarma's progressive translation system.
 *
 * AudarEvent is a discriminated union (tagged by `type`) describing the
 * lifecycle of a translation pass: cache hits/misses, the start of a
 * translate request, success (with latency), and errors (with the attempt
 * number for retry-aware consumers).
 *
 * Audarma emits ONLY what it can observe. In particular it does NOT emit
 * token usage or cost, because the LLMProvider.translateBatch contract
 * returns a plain string[] and exposes no usage information.
 */

/**
 * Translations for `count` items were served from cache (localStorage
 * metadata + DB rows whose source_hash matched the current source text).
 */
export interface CacheHitEvent {
  type: 'cache_hit';
  viewName: string;
  locale: string;
  count: number;
}

/**
 * `count` items were not present in cache (or were stale) and need to be
 * translated.
 */
export interface CacheMissEvent {
  type: 'cache_miss';
  viewName: string;
  locale: string;
  count: number;
}

/**
 * A translate request is starting for `count` items, split across `batches`
 * LLM calls.
 */
export interface TranslateStartEvent {
  type: 'translate_start';
  viewName: string;
  locale: string;
  count: number;
  batches: number;
}

/**
 * A translate request completed successfully. `latencyMs` is the wall-clock
 * time spent in the translate pass (all batches).
 */
export interface TranslateSuccessEvent {
  type: 'translate_success';
  viewName: string;
  locale: string;
  count: number;
  latencyMs: number;
}

/**
 * A translate attempt failed. `attempt` is 1-based and increments per retry;
 * `error` is the thrown value (kept as `unknown` since the LLMProvider may
 * throw any value).
 */
export interface TranslateErrorEvent {
  type: 'translate_error';
  viewName: string;
  locale: string;
  attempt: number;
  error: unknown;
}

/**
 * Discriminated union of all events Audarma can emit through
 * {@link AudarConfig.onEvent}.
 */
export type AudarEvent =
  | CacheHitEvent
  | CacheMissEvent
  | TranslateStartEvent
  | TranslateSuccessEvent
  | TranslateErrorEvent;
