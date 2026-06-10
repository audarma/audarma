/**
 * Server-Component-safe translation entry point for Audarma.
 *
 * This module is the implementation behind the `audarma/server` subpath. It is
 * intentionally framework- and React-free so it can run inside Next.js App
 * Router Server Components / Route Handlers / Server Actions without dragging
 * in the `'use client'` provider.
 *
 * Key properties:
 *  - NO React, NO hooks, NO localStorage. State lives entirely in the DB cache.
 *  - Reuses the SAME cache + hashing helpers as the client provider
 *    (`buildCacheFromDbResults`, `canonicalItemHash`) so a server-side
 *    translation and a client-side translation of identical source text share
 *    a cache row.
 *  - The source language is `config.defaultLocale` (NOT hardcoded English).
 *  - NEVER throws on an LLM/DB failure: it falls back to returning source text
 *    for the un-translated items (best-effort progressive translation).
 */

import type {
  AudarConfig,
  AudarEvent,
  TranslateOptions,
  TranslationItem,
} from '../types';
import { buildCacheFromDbResults, canonicalItemHash } from '../core/cache';
import { withRetry } from '../core/retry';

/**
 * Arguments for {@link translateView}.
 */
export interface TranslateViewArgs {
  /** The content items to translate (each with contentType, contentId, text). */
  items: TranslationItem[];

  /** Locale to translate INTO (e.g. 'ru'). */
  targetLocale: string;

  /**
   * Locale the source `text` is written in. Defaults to
   * `config.defaultLocale` (NOT hardcoded 'en'). When equal to `targetLocale`
   * the call is a passthrough — no DB query, no LLM call.
   */
  sourceLocale?: string;

  /**
   * Logical view name, used only for observability events. Defaults to
   * 'server'.
   */
  viewName?: string;

  /**
   * Per-call LLM directives (system prompt, glossary, do-not-translate terms,
   * formality, signal). When omitted, the directives from
   * `config.translation` are used as a fallback.
   */
  options?: TranslateOptions;
}

/**
 * Translate (or fetch cached translations for) a set of items for a target
 * locale, server-side.
 *
 * Resolution order per item:
 *   1. Passthrough — if `targetLocale === sourceLocale`, return source text.
 *   2. Fresh DB cache hit — a cached row whose `source_hash` matches the
 *      current canonical hash of the source text.
 *   3. LLM translation of the remaining misses, persisted to the DB cache.
 *   4. Fallback to source text for anything that still has no translation
 *      (sparse/short provider result, or an LLM/DB error).
 *
 * @returns A map of `"contentType:contentId"` -> translated text (or source
 *   text on a miss-fallback). NEVER throws for an LLM/DB failure.
 */
export async function translateView(
  config: AudarConfig,
  args: TranslateViewArgs
): Promise<Record<string, string>> {
  const { items, targetLocale } = args;
  const viewName = args.viewName ?? 'server';
  const sourceLocale =
    args.sourceLocale ?? config.defaultLocale ?? config.i18n.getDefaultLocale();

  const emit = (event: AudarEvent): void => {
    try {
      config.onEvent?.(event);
    } catch {
      // Observability must never break translation. Swallow callback errors.
    }
  };

  const sourceMap = (subset: TranslationItem[]): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const item of subset) {
      map[`${item.contentType}:${item.contentId}`] = item.text;
    }
    return map;
  };

  // 1. Passthrough: nothing to translate when source === target, or no items.
  if (items.length === 0 || targetLocale === sourceLocale) {
    return sourceMap(items);
  }

  // Merge per-call options over config-level translation directives. Per-call
  // options win; when neither is set the result is `undefined` so the provider
  // sees the original 3-arg behavior.
  const mergedOptions = mergeOptions(config.translation, args.options);

  // 2. Read DB cache and split into fresh hits vs. misses (source_hash-aware).
  let cache: Record<string, string>;
  let uncachedItems: TranslationItem[];

  try {
    const dbResults = await config.database.getCachedTranslations(items, targetLocale);
    const built = buildCacheFromDbResults(items, dbResults);
    cache = built.cache;
    uncachedItems = built.uncachedItems;
  } catch (error) {
    // DB read failed — treat everything as a miss; the LLM pass below (and its
    // own try/catch) decides whether we can translate or must fall back.
    if (config.debug) {
      console.error(`[Audar][server] Error reading cache for ${viewName} (${targetLocale}):`, error);
    }
    cache = {};
    uncachedItems = items;
  }

  const hitCount = items.length - uncachedItems.length;
  if (hitCount > 0) {
    emit({ type: 'cache_hit', viewName, locale: targetLocale, count: hitCount });
  }

  // Everything was a fresh cache hit — done, no LLM call.
  if (uncachedItems.length === 0) {
    return cache;
  }

  emit({ type: 'cache_miss', viewName, locale: targetLocale, count: uncachedItems.length });

  // 3. Translate the misses via the LLM, optionally under the retry policy.
  // Build the result starting from the fresh cache hits, then fill in source
  // text as the default for every miss so an LLM/sparse failure degrades
  // gracefully to passthrough.
  const result: Record<string, string> = { ...cache, ...sourceMap(uncachedItems) };

  emit({ type: 'translate_start', viewName, locale: targetLocale, count: uncachedItems.length, batches: 1 });

  const startedAt = Date.now();

  // Track the 1-based attempt number so translate_error events report the
  // correct attempt even though withRetry does not surface it to `fn`.
  let attempt = 0;

  try {
    const translatedTexts = await withRetry(
      (signal) => {
        attempt += 1;
        // Forward the per-attempt abort signal (set only when retry.timeoutMs
        // is configured) without clobbering a caller-provided one.
        const callOptions =
          signal && !mergedOptions?.signal
            ? { ...(mergedOptions ?? {}), signal }
            : mergedOptions;
        return config.llm.translateBatch(uncachedItems, sourceLocale, targetLocale, callOptions);
      },
      config.retry
    );

    // Guard against a short / sparse / non-string provider result: only accept
    // non-empty strings; anything else keeps the source-text fallback already
    // seeded in `result`, and is NOT persisted (so it retries next time).
    const translationsToSave: Array<{
      content_type: string;
      content_id: string;
      locale: string;
      original_text: string;
      translated_text: string;
      source_hash: string;
    }> = [];

    uncachedItems.forEach((item, idx) => {
      const translated = translatedTexts?.[idx];
      if (typeof translated !== 'string' || translated.length === 0) return;

      const key = `${item.contentType}:${item.contentId}`;
      result[key] = translated;
      translationsToSave.push({
        content_type: item.contentType,
        content_id: item.contentId,
        locale: targetLocale,
        original_text: item.text,
        translated_text: translated,
        source_hash: canonicalItemHash(item.text),
      });
    });

    if (translationsToSave.length > 0) {
      try {
        await config.database.saveTranslations(translationsToSave);
      } catch (saveError) {
        // Persist failure must not lose the in-memory translations or throw.
        if (config.debug) {
          console.error(`[Audar][server] Error saving translations for ${viewName} (${targetLocale}):`, saveError);
        }
      }
    }

    emit({
      type: 'translate_success',
      viewName,
      locale: targetLocale,
      count: translationsToSave.length,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    // LLM (or retry-exhausted) failure: never throw out of translateView.
    // `result` already holds source-text fallbacks for every miss.
    emit({
      type: 'translate_error',
      viewName,
      locale: targetLocale,
      attempt: Math.max(1, attempt),
      error,
    });
    if (config.debug) {
      console.error(`[Audar][server] Error translating ${viewName} (${targetLocale}):`, error);
    }
  }

  return result;
}

/**
 * Merge config-level translation directives with per-call options. Per-call
 * options take precedence. Returns `undefined` when neither side supplies any
 * directive, so the provider sees the original 3-arg `translateBatch` shape.
 */
function mergeOptions(
  directives: AudarConfig['translation'],
  options: TranslateOptions | undefined
): TranslateOptions | undefined {
  if (!directives && !options) return undefined;
  const merged: TranslateOptions = { ...(directives ?? {}), ...(options ?? {}) };
  return merged;
}
