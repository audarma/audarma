/**
 * Content Sources Configuration Types
 * Used by CLI to discover translatable content
 */

/**
 * Defines where to find translatable content in database
 */
export interface ContentSourceItem {
  /**
   * Content type identifier (e.g., 'product_title', 'post_body')
   * Must match the contentType used in ViewTranslationProvider
   */
  contentType: string;

  /**
   * Column name containing the text to translate
   */
  textColumn: string;

  /**
   * Optional: SQL WHERE clause conditions
   * Example: { status: 'published', is_verified: true }
   */
  where?: Record<string, any>;
}

/**
 * Defines a table containing translatable content
 */
export interface ContentSource {
  /**
   * Table name in database
   */
  table: string;

  /**
   * Column containing unique identifier (usually 'id')
   */
  idColumn: string;

  /**
   * List of translatable fields in this table
   */
  items: ContentSourceItem[];

  /**
   * Optional: SQL WHERE clause for filtering rows
   * Example: { status: 'published' }
   */
  where?: Record<string, any>;
}

/**
 * CLI Configuration
 */
export interface AudarCLIConfig {
  /**
   * Content sources to scan
   */
  contentSources: ContentSource[];

  /**
   * Target locales to translate to
   * Example: ['ru', 'kk', 'ja']
   */
  locales: string[];

  /**
   * Source locale (default: 'en')
   */
  sourceLocale?: string;

  /**
   * Optional: Exclude specific content types from CLI translation
   * These will only be handled by lazy mode
   * Example: ['message_text', 'comment_text']
   */
  excludeTypes?: string[];

  /**
   * Optional: Batch size for LLM calls (default: 20)
   */
  batchSize?: number;

  /**
   * Optional: Maximum items to translate (for testing)
   */
  maxItems?: number;
}

/**
 * Content item discovered by CLI
 */
export interface DiscoveredContent {
  contentType: string;
  contentId: string;
  text: string;
  sourceHash: string;
}

/**
 * Translation gap (content missing translation for locale)
 */
export interface TranslationGap {
  contentType: string;
  contentId: string;
  text: string;
  sourceHash: string;
  missingLocales: string[];
}

/**
 * CLI translation progress
 */
export interface TranslationProgress {
  locale: string;
  itemsTotal: number;
  itemsCompleted: number;
  batchNumber: number;
  totalBatches: number;
  estimatedCost: number;
}

/**
 * CLI translation result
 */
export interface TranslationResult {
  totalItems: number;
  translatedItems: number;
  cachedItems: number;
  totalCost: number;
  duration: number;
  locales: string[];
  summary: Record<string, {
    items: number;
    cost: number;
  }>;
}
