'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import crypto from 'crypto-js';
import type {
  AudarConfig,
  TranslationItem,
  ViewTranslationMetadata,
  UseViewTranslationResult,
} from '../types';

interface ViewTranslationCache {
  [key: string]: string; // "contentType:contentId" -> translated text
}

interface ViewTranslationContextValue {
  cache: ViewTranslationCache;
  isTranslating: boolean;
  getTranslation: (contentType: string, contentId: string, fallback: string) => string;
  isItemTranslating: (contentType: string, contentId: string) => boolean;
}

const ViewTranslationContext = createContext<ViewTranslationContextValue>({
  cache: {},
  isTranslating: false,
  getTranslation: () => '',
  isItemTranslating: () => false,
});

// Global config context (set by AudarProvider)
const AudarConfigContext = createContext<AudarConfig | null>(null);

interface AudarProviderProps {
  config: AudarConfig;
  children: ReactNode;
}

/**
 * AudarProvider - Global configuration provider
 *
 * Wrap your app root with this provider to configure adapters
 *
 * @example
 * ```tsx
 * <AudarProvider config={{
 *   database: supabaseAdapter,
 *   llm: nebiusAdapter,
 *   i18n: nextIntlAdapter
 * }}>
 *   <App />
 * </AudarProvider>
 * ```
 */
export function AudarProvider({ config, children }: AudarProviderProps) {
  return (
    <AudarConfigContext.Provider value={config}>
      {children}
    </AudarConfigContext.Provider>
  );
}

interface ViewTranslationProviderProps {
  viewName: string; // 'feed', 'dashboard', 'shop:handle', 'product:id'
  items: TranslationItem[];
  children: ReactNode;
}

/**
 * ViewTranslationProvider - Smart view-level translation system
 *
 * Tracks translation state per view, calculates content hash, and only
 * translates when needed (never translated OR English content changed)
 *
 * @example
 * ```tsx
 * <ViewTranslationProvider viewName="feed" items={productItems}>
 *   <ProductCard product={product} />
 * </ViewTranslationProvider>
 * ```
 */
export function ViewTranslationProvider({ viewName, items, children }: ViewTranslationProviderProps) {
  const config = useContext(AudarConfigContext);

  if (!config) {
    throw new Error('ViewTranslationProvider must be used within AudarProvider');
  }

  const locale = config.i18n.getCurrentLocale();
  const defaultLocale = config.defaultLocale || config.i18n.getDefaultLocale();

  const [cache, setCache] = useState<ViewTranslationCache>({});
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    // Skip if default locale or no items
    if (locale === defaultLocale || items.length === 0) {
      setCache({});
      setIsTranslating(false);
      return;
    }

    const translateView = async () => {
      // 1. Calculate content hash (hash of all content IDs + texts)
      const contentString = items
        .map((item) => `${item.contentType}:${item.contentId}:${item.text}`)
        .sort()
        .join('|');
      const contentHash = crypto.SHA256(contentString).toString().substring(0, 16);

      // 2. Check localStorage for cached metadata
      const metadataKey = `translation_metadata_${viewName}_${locale}`;
      const cachedMetadata = localStorage.getItem(metadataKey);

      if (cachedMetadata) {
        try {
          const metadata: ViewTranslationMetadata = JSON.parse(cachedMetadata);

          // Content hash matches AND same number of items - use cache
          if (metadata.contentHash === contentHash && metadata.itemCount === items.length) {
            if (config.debug) {
              console.log(
                `[Audar] ✓ Using cached translations for ${viewName} (${locale}). ` +
                `Last translated: ${new Date(metadata.lastTranslated).toLocaleString()}`
              );
            }

            // Load from database cache
            await loadFromDatabaseCache();
            return;
          } else {
            if (config.debug) {
              console.log(
                `[Audar] Content changed for ${viewName} (${locale}). ` +
                `Old hash: ${metadata.contentHash.substring(0, 8)}..., New hash: ${contentHash.substring(0, 8)}...`
              );
            }
          }
        } catch (e) {
          if (config.debug) {
            console.warn('[Audar] Failed to parse cached metadata:', e);
          }
        }
      } else {
        if (config.debug) {
          console.log(`[Audar] First-time translation for ${viewName} (${locale})`);
        }
      }

      // 3. Need to translate - fetch from database first, then translate missing
      setIsTranslating(true);

      try {
        // Fetch cached translations from database
        const cachedResults = await config.database.getCachedTranslations(items, locale);

        // Build cache map from database results
        const newCache: ViewTranslationCache = {};
        const cachedMap = new Map(
          cachedResults.map((r) => [`${r.content_type}:${r.content_id}`, r.translated_text])
        );

        // Identify items that need translation
        const uncachedItems: TranslationItem[] = [];
        items.forEach((item) => {
          const key = `${item.contentType}:${item.contentId}`;
          const cached = cachedMap.get(key);

          if (cached) {
            newCache[key] = cached;
          } else {
            uncachedItems.push(item);
          }
        });

        if (config.debug) {
          console.log(
            `[Audar] Found ${cachedResults.length} cached, need to translate ${uncachedItems.length} items`
          );
        }

        // Translate uncached items
        if (uncachedItems.length > 0) {
          const translatedTexts = await config.llm.translateBatch(
            uncachedItems,
            defaultLocale,
            locale
          );

          // Save to database
          const translationsToSave = uncachedItems.map((item, idx) => ({
            content_type: item.contentType,
            content_id: item.contentId,
            locale,
            original_text: item.text,
            translated_text: translatedTexts[idx],
            source_hash: crypto.SHA256(item.text).toString(),
          }));

          await config.database.saveTranslations(translationsToSave);

          // Add to cache
          uncachedItems.forEach((item, idx) => {
            const key = `${item.contentType}:${item.contentId}`;
            newCache[key] = translatedTexts[idx];
          });

          if (config.debug) {
            console.log(`[Audar] ✓ Translated ${uncachedItems.length} new items for ${viewName} (${locale})`);
          }
        }

        setCache(newCache);

        // Save metadata to localStorage
        const metadata: ViewTranslationMetadata = {
          contentHash,
          lastTranslated: new Date().toISOString(),
          locale,
          itemCount: items.length,
        };
        localStorage.setItem(metadataKey, JSON.stringify(metadata));

      } catch (error) {
        if (config.debug) {
          console.error(`[Audar] Error translating ${viewName}:`, error);
        }
      } finally {
        setIsTranslating(false);
      }
    };

    // Load cached translations from database
    async function loadFromDatabaseCache() {
      if (!config) return; // TypeScript guard (should never happen due to earlier check)

      try {
        const cachedResults = await config.database.getCachedTranslations(items, locale);

        const newCache: ViewTranslationCache = {};
        cachedResults.forEach((r) => {
          const key = `${r.content_type}:${r.content_id}`;
          newCache[key] = r.translated_text;
        });

        setCache(newCache);

        if (config.debug && Object.keys(newCache).length > 0) {
          console.log(
            `[Audar] ⚡ Loaded ${Object.keys(newCache).length} cached translations for ${viewName} (${locale})`
          );
        }
      } catch (error) {
        if (config.debug) {
          console.error(`[Audar] Error loading cache for ${viewName}:`, error);
        }
        // Fallback: translate fresh
        translateView();
      }
    }

    translateView();
  }, [viewName, locale, items.length]); // Re-run when items length changes

  const getTranslation = (contentType: string, contentId: string, fallback: string): string => {
    if (locale === defaultLocale) return fallback;
    const key = `${contentType}:${contentId}`;
    return cache[key] || fallback;
  };

  const isItemTranslating = (contentType: string, contentId: string): boolean => {
    if (locale === defaultLocale) return false;
    const key = `${contentType}:${contentId}`;
    return isTranslating && !cache[key];
  };

  return (
    <ViewTranslationContext.Provider
      value={{
        cache,
        isTranslating,
        getTranslation,
        isItemTranslating,
      }}
    >
      {children}
    </ViewTranslationContext.Provider>
  );
}

/**
 * useViewTranslation - Get translated text for a specific content item
 *
 * Must be used within ViewTranslationProvider
 *
 * @example
 * ```tsx
 * const { text, isTranslating } = useViewTranslation('product_title', product.id, product.title);
 * ```
 */
export function useViewTranslation(
  contentType: string,
  contentId: string,
  originalText: string
): UseViewTranslationResult {
  const { getTranslation, isItemTranslating } = useContext(ViewTranslationContext);

  return {
    text: getTranslation(contentType, contentId, originalText),
    isTranslating: isItemTranslating(contentType, contentId),
  };
}

/**
 * useViewTranslationStatus - Get overall translation status for the view
 *
 * @example
 * ```tsx
 * const { isTranslating } = useViewTranslationStatus();
 * ```
 */
export function useViewTranslationStatus() {
  const { isTranslating } = useContext(ViewTranslationContext);
  return { isTranslating };
}
