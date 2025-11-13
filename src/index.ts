/**
 * Audar - Progressive Translation System
 *
 * A React/Next.js translation system with smart caching and view-level translation tracking.
 *
 * @example
 * ```tsx
 * import { AudarProvider, ViewTranslationProvider, useViewTranslation } from 'audar';
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
} from './core/ViewTranslationProvider';

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
