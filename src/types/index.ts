/**
 * Core types for Audar progressive translation system
 */

import type { AudarEvent } from './events';

export type { AudarEvent } from './events';
export type {
  CacheHitEvent,
  CacheMissEvent,
  TranslateStartEvent,
  TranslateSuccessEvent,
  TranslateErrorEvent,
} from './events';

export interface TranslationItem {
  contentType: string;
  contentId: string;
  text: string;
}

/**
 * Per-call options for an LLM translation request.
 *
 * All fields are optional. When none are provided the request behaves exactly
 * as the original three-argument `translateBatch` call, so existing providers
 * and call sites are unaffected.
 */
export interface TranslateOptions {
  /**
   * System prompt / instruction prepended to the translation request to steer
   * tone, domain, or style.
   */
  systemPrompt?: string;

  /**
   * Glossary mapping a source term to its REQUIRED target translation. The
   * provider should translate these terms exactly as specified.
   */
  glossary?: Record<string, string>;

  /**
   * Terms that MUST survive verbatim in the output (e.g. brand or product
   * names). The provider should leave these untranslated.
   */
  doNotTranslate?: string[];

  /**
   * Desired formality register of the translation.
   */
  formality?: 'formal' | 'informal' | 'neutral';

  /**
   * Abort signal for timeout / cancellation of the underlying request.
   */
  signal?: AbortSignal;
}

export interface ViewTranslationMetadata {
  contentHash: string;
  lastTranslated: string;
  locale: string;
  itemCount: number;
}

export interface TranslationResult {
  contentType: string;
  contentId: string;
  originalText: string;
  translatedText: string;
  cached: boolean;
}

export interface TranslationResponse {
  success: boolean;
  translations: TranslationResult[];
  metadata: {
    sourceLocale: string;
    targetLocale: string;
    totalItems: number;
    cachedItems: number;
    translatedItems: number;
    timestamp: string;
  };
}

/**
 * Database Adapter Interface
 * Implement this to use any database backend
 */
export interface DatabaseAdapter {
  /**
   * Fetch cached translations for given items
   */
  getCachedTranslations(
    items: TranslationItem[],
    targetLocale: string
  ): Promise<Array<{
    content_type: string;
    content_id: string;
    translated_text: string;
    source_hash: string;
  }>>;

  /**
   * Save new translations to cache
   */
  saveTranslations(
    translations: Array<{
      content_type: string;
      content_id: string;
      locale: string;
      original_text: string;
      translated_text: string;
      source_hash: string;
    }>
  ): Promise<void>;

  /**
   * OPTIONAL: Delete cached translation rows matching the given filter.
   *
   * Used by the invalidation API to evict stale translations. An undefined
   * field means "do not constrain on this field" (e.g. omitting `locale`
   * deletes the matching rows across all locales). An empty filter `{}`
   * deletes all rows.
   *
   * @param filter - Constraints on which rows to delete
   */
  deleteTranslations?(filter: {
    contentType?: string;
    contentId?: string;
    locale?: string;
  }): Promise<void>;

  /**
   * OPTIONAL: Discover all translatable content from source tables
   * Required for CLI batch translation mode
   *
   * @param contentSources - Configuration of tables and columns to scan
   * @returns Array of discovered content items
   */
  getAllTranslatableContent?(
    contentSources: Array<{
      table: string;
      idColumn: string;
      items: Array<{
        contentType: string;
        textColumn: string;
        where?: Record<string, any>;
      }>;
      where?: Record<string, any>;
    }>
  ): Promise<Array<{
    contentType: string;
    contentId: string;
    text: string;
  }>>;
}

/**
 * LLM Provider Interface
 * Implement this to use any LLM service
 */
export interface LLMProvider {
  /**
   * Translate a batch of items
   *
   * @param items - Items to translate
   * @param sourceLocale - Source language code (e.g., 'en')
   * @param targetLocale - Target language code (e.g., 'ru')
   * @param options - OPTIONAL per-call directives (system prompt, glossary,
   *   do-not-translate terms, formality, abort signal). Implementations that
   *   ignore this parameter remain fully compatible.
   * @returns Array of translated texts in same order as input
   */
  translateBatch(
    items: TranslationItem[],
    sourceLocale: string,
    targetLocale: string,
    options?: TranslateOptions
  ): Promise<string[]>;
}

/**
 * I18n Adapter Interface
 * Implement this to integrate with any i18n library
 */
export interface I18nAdapter {
  /**
   * Get current locale
   */
  getCurrentLocale(): string;

  /**
   * Get default/fallback locale
   */
  getDefaultLocale(): string;

  /**
   * Get list of supported locales
   */
  getSupportedLocales(): string[];
}

/**
 * Translation directives applied to every translate request unless overridden
 * per call. Mirrors the steerable fields of {@link TranslateOptions}.
 */
export interface TranslationDirectives {
  /**
   * System prompt / instruction to steer tone, domain, or style.
   */
  systemPrompt?: string;

  /**
   * Glossary mapping a source term to its REQUIRED target translation.
   */
  glossary?: Record<string, string>;

  /**
   * Terms that MUST survive verbatim in the output (e.g. brand/product names).
   */
  doNotTranslate?: string[];

  /**
   * Desired formality register of the translation.
   */
  formality?: 'formal' | 'informal' | 'neutral';
}

/**
 * Retry / timeout policy for translate requests.
 *
 * Defaults preserve current behavior: `attempts` defaults to 1 (no retry),
 * and retries occur ONLY on a thrown error or timeout.
 */
export interface RetryConfig {
  /**
   * Total number of attempts (including the first). Default 1 (NO retry).
   */
  attempts?: number;

  /**
   * Base delay in milliseconds between retry attempts (used as the basis for
   * any backoff). Only relevant when `attempts` > 1.
   */
  baseDelayMs?: number;

  /**
   * Per-attempt timeout in milliseconds. A timeout is treated as a thrown
   * error and triggers a retry (subject to `attempts`).
   */
  timeoutMs?: number;
}

/**
 * Batching policy for splitting a translate pass into LLM calls.
 *
 * Defaults preserve current behavior: a single batch containing all items.
 */
export interface BatchingConfig {
  /**
   * Maximum number of items per LLM call. Default: all items in one batch.
   */
  maxBatchSize?: number;

  /**
   * Maximum number of batches translated concurrently. Default: 1.
   */
  maxConcurrentBatches?: number;

  /**
   * Minimum interval in milliseconds between batch starts (simple rate
   * limiting). Default: 0 (no throttling).
   */
  minBatchIntervalMs?: number;
}

/**
 * Main Audar Configuration
 */
export interface AudarConfig {
  /**
   * Database adapter for caching translations
   */
  database: DatabaseAdapter;

  /**
   * LLM provider for generating translations
   */
  llm: LLMProvider;

  /**
   * I18n adapter for locale management
   */
  i18n: I18nAdapter;

  /**
   * Default source locale (usually 'en')
   */
  defaultLocale?: string;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * OPTIONAL: Translation directives (system prompt, glossary, do-not-translate
   * terms, formality) applied to translate requests. Default: undefined (no
   * directives — current behavior).
   */
  translation?: TranslationDirectives;

  /**
   * OPTIONAL: Retry / timeout policy. Default: undefined; `attempts` defaults
   * to 1 (NO retry). Retries occur ONLY on a thrown error or timeout.
   */
  retry?: RetryConfig;

  /**
   * OPTIONAL: Batching policy. Default: undefined — a single batch containing
   * all items (current behavior).
   */
  batching?: BatchingConfig;

  /**
   * OPTIONAL: Observability callback invoked for each {@link AudarEvent}.
   * Default: undefined (no-op — current behavior).
   */
  onEvent?: (event: AudarEvent) => void;
}

/**
 * Hook return type for useViewTranslation
 */
export interface UseViewTranslationResult {
  text: string;
  isTranslating: boolean;
}
