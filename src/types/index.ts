/**
 * Core types for Audar progressive translation system
 */

export interface TranslationItem {
  contentType: string;
  contentId: string;
  text: string;
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
    estimatedCost?: number;
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
   * @returns Array of translated texts in same order as input
   */
  translateBatch(
    items: TranslationItem[],
    sourceLocale: string,
    targetLocale: string
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
}

/**
 * Hook return type for useViewTranslation
 */
export interface UseViewTranslationResult {
  text: string;
  isTranslating: boolean;
}
