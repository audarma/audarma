'use client';

import { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import type {
  AudarConfig,
  TranslationItem,
  ViewTranslationMetadata,
  UseViewTranslationResult,
} from '../types';
import { computeViewContentHash, canonicalItemHash, buildCacheFromDbResults } from './cache';

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

  // Track current locale reactively - call getCurrentLocale() on every render
  // to detect when user switches languages
  const [currentLocale, setCurrentLocale] = useState(() => config.i18n.getCurrentLocale());
  const defaultLocale = config.defaultLocale || config.i18n.getDefaultLocale();

  const [cache, setCache] = useState<ViewTranslationCache>({});
  const [isTranslating, setIsTranslating] = useState(false);

  // Detect locale changes and clear cache when locale switches.
  // NOTE: this effect intentionally has NO dependency array — the I18nAdapter
  // interface has no subscribe method, so polling getCurrentLocale() on every
  // render is the only way to detect external locale switches. The early-out
  // comparison below makes the no-op path cheap (a string compare + nothing
  // else), so leaving it dependency-less is safe and avoids regressions.
  useEffect(() => {
    const newLocale = config.i18n.getCurrentLocale();
    if (newLocale !== currentLocale) {
      if (config.debug) {
        console.log(`[Audar] Locale changed from ${currentLocale} to ${newLocale} - clearing cache`);
      }
      setCurrentLocale(newLocale);
      setCache({}); // Clear stale translations
      setIsTranslating(false);
    }
  });

  // Stable, order-independent hash of the view's content. This drives the
  // translation effect so that ANY change to item text (not just item count)
  // re-fires the effect and re-translates changed items.
  //
  // The memo deps on a serialized fingerprint of the items' content rather
  // than the array reference, so it stays correct even if a parent passes the
  // same array reference across renders while mutating item text in place.
  const contentFingerprint = items
    .map((item) => `${item.contentType}:${item.contentId}:${item.text}`)
    .join('|');
  const contentHash = useMemo(() => computeViewContentHash(items), [contentFingerprint]);

  // Keep the latest items available inside the translation effect without
  // making the effect re-run on unrelated re-renders. The effect depends on
  // contentHash (which already captures every text/id change), so reading
  // items from this ref is equivalent to closing over the current snapshot.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const items = itemsRef.current;

    // Skip if default locale or no items
    if (currentLocale === defaultLocale || items.length === 0) {
      setCache({});
      setIsTranslating(false);
      return;
    }

    const translateView = async (forceTranslate = false) => {
      // 1. Check localStorage for cached metadata. When forceTranslate is set
      // (the stale-row recovery path calls back in), we skip this check and go
      // straight to the translate pass below — otherwise the metadata would
      // still match and route us back into loadFromDatabaseCache, recursing
      // forever until the DB happens to return fresh rows.
      const metadataKey = `translation_metadata_${viewName}_${currentLocale}`;
      const cachedMetadata = forceTranslate ? null : localStorage.getItem(metadataKey);

      if (cachedMetadata) {
        try {
          const metadata: ViewTranslationMetadata = JSON.parse(cachedMetadata);

          // Content hash matches AND same number of items - use cache
          if (metadata.contentHash === contentHash && metadata.itemCount === items.length) {
            if (config.debug) {
              console.log(
                `[Audar] ✓ Using cached translations for ${viewName} (${currentLocale}). ` +
                `Last translated: ${new Date(metadata.lastTranslated).toLocaleString()}`
              );
            }

            // Load from database cache
            await loadFromDatabaseCache();
            return;
          } else {
            if (config.debug) {
              console.log(
                `[Audar] Content changed for ${viewName} (${currentLocale}). ` +
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
          console.log(`[Audar] First-time translation for ${viewName} (${currentLocale})`);
        }
      }

      // 2. Need to translate - fetch from database first, then translate missing
      setIsTranslating(true);

      try {
        // Fetch cached translations from database
        const cachedResults = await config.database.getCachedTranslations(items, currentLocale);

        // Build cache map from database results. A DB row is only a valid hit
        // when its source_hash matches the current canonical hash of the
        // item's text — rows translated from stale source text are treated as
        // a miss and re-translated below.
        const { cache: newCache, uncachedItems } = buildCacheFromDbResults(items, cachedResults);

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
            currentLocale
          );

          // Save to database
          const translationsToSave = uncachedItems.map((item, idx) => ({
            content_type: item.contentType,
            content_id: item.contentId,
            locale: currentLocale,
            original_text: item.text,
            translated_text: translatedTexts[idx],
            source_hash: canonicalItemHash(item.text),
          }));

          await config.database.saveTranslations(translationsToSave);

          // Add to cache
          uncachedItems.forEach((item, idx) => {
            const key = `${item.contentType}:${item.contentId}`;
            newCache[key] = translatedTexts[idx];
          });

          if (config.debug) {
            console.log(`[Audar] ✓ Translated ${uncachedItems.length} new items for ${viewName} (${currentLocale})`);
          }
        }

        setCache(newCache);

        // Save metadata to localStorage
        const metadata: ViewTranslationMetadata = {
          contentHash,
          lastTranslated: new Date().toISOString(),
          locale: currentLocale,
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
        const cachedResults = await config.database.getCachedTranslations(items, currentLocale);

        // Only rows whose source_hash matches the current item text are valid
        // hits. Stale/missing rows surface as uncachedItems below.
        const { cache: newCache, uncachedItems } = buildCacheFromDbResults(items, cachedResults);

        // If any items are stale (source_hash mismatch) or missing from the
        // DB, run a full translate pass instead of committing the partial
        // cache — committing it here would flash partially-translated content
        // before the translate pass overwrites it. translateView(true) skips
        // the metadata check (which still matches) and re-fetches, merges valid
        // hits, translates the rest, and re-saves.
        if (uncachedItems.length > 0) {
          if (config.debug) {
            console.log(
              `[Audar] ${uncachedItems.length} item(s) stale or missing in cache for ${viewName} (${currentLocale}) - re-translating`
            );
          }
          translateView(true);
          return;
        }

        setCache(newCache);

        if (config.debug && Object.keys(newCache).length > 0) {
          console.log(
            `[Audar] ⚡ Loaded ${Object.keys(newCache).length} cached translations for ${viewName} (${currentLocale})`
          );
        }
      } catch (error) {
        if (config.debug) {
          console.error(`[Audar] Error loading cache for ${viewName}:`, error);
        }
        // Fallback: translate fresh
        translateView(true);
      }
    }

    translateView();
    // Depend on the memoized content hash (not items.length) so the effect
    // re-fires whenever ANY item's text or id changes — even when the item
    // count is unchanged. items themselves are read from itemsRef inside the
    // effect to avoid re-running on unrelated re-renders.
  }, [viewName, currentLocale, contentHash]);

  const getTranslation = (contentType: string, contentId: string, fallback: string): string => {
    if (currentLocale === defaultLocale) return fallback;
    const key = `${contentType}:${contentId}`;
    return cache[key] || fallback;
  };

  const isItemTranslating = (contentType: string, contentId: string): boolean => {
    if (currentLocale === defaultLocale) return false;
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
