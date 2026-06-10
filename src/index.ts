/**
 * Audarma - Progressive Translation System
 *
 * A React/Next.js translation system with smart caching and view-level translation tracking.
 *
 * @example
 * ```tsx
 * import { AudarProvider, ViewTranslationProvider, useViewTranslation } from 'audarma';
 *
 * // Configure at app root
 * <AudarProvider config={{
 *   database: yourDatabaseAdapter,
 *   llm: yourLLMProvider,
 *   i18n: yourI18nAdapter
 * }}>
 *   <App />
 * </AudarProvider>
 *
 * // Use in views
 * <ViewTranslationProvider viewName="feed" items={productItems}>
 *   <ProductCard />
 * </ViewTranslationProvider>
 *
 * // Get translated text
 * const { text, isTranslating } = useViewTranslation('product_title', product.id, product.title);
 * ```
 */

// Core components
export {
  AudarProvider,
  ViewTranslationProvider,
  useViewTranslation,
  useViewTranslationStatus,
  useAudarInvalidator,
} from './core/ViewTranslationProvider';

// Pure cache helpers (exported for testing and advanced consumers)
export {
  computeViewContentHash,
  canonicalItemHash,
  buildCacheFromDbResults,
} from './core/cache';

// Programmatic cache invalidation (framework-agnostic factory). The React hook
// `useAudarInvalidator` (above) wraps this with config from AudarProvider.
export { createInvalidator } from './core/invalidation';
export type { AudarInvalidator } from './core/invalidation';

// Type definitions
export type {
  TranslationItem,
  ViewTranslationMetadata,
  TranslationResult,
  TranslationResponse,
  DatabaseAdapter,
  LLMProvider,
  I18nAdapter,
  AudarConfig,
  UseViewTranslationResult,
  // v0.2 additions
  TranslateOptions,
  TranslationDirectives,
  RetryConfig,
  BatchingConfig,
  AudarEvent,
  CacheHitEvent,
  CacheMissEvent,
  TranslateStartEvent,
  TranslateSuccessEvent,
  TranslateErrorEvent,
} from './types';

// CLI Configuration Types
export type {
  ContentSource,
  ContentSourceItem,
  AudarCLIConfig,
  DiscoveredContent,
  TranslationGap,
  TranslationProgress,
  TranslationResult as CLITranslationResult,
} from './types/content-sources';
