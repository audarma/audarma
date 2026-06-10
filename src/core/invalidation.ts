/**
 * Programmatic cache-invalidation for Audarma.
 *
 * Provides a small, framework-agnostic factory ({@link createInvalidator}) for
 * evicting stale translations from two caches:
 *
 *   1. The DATABASE cache — rows persisted by the translate pass. Evicted via
 *      the OPTIONAL {@link DatabaseAdapter.deleteTranslations} method.
 *   2. The LOCAL localStorage metadata — the per-view fingerprint the provider
 *      writes under `translation_metadata_${viewName}_${locale}`. Evicting it
 *      forces the provider to re-check the DB cache (and re-translate misses)
 *      on its next mount.
 *
 * This module is intentionally free of React: it can be called from server
 * actions, route handlers, CLI scripts, or the browser. The React hook
 * (`useAudarInvalidator`) that reads config from `AudarProvider` context lives
 * in the provider module, not here.
 */

import type { AudarConfig } from '../types';

/**
 * The localStorage key the provider uses to fingerprint a translated view.
 *
 * MUST stay byte-for-byte identical to the key written in
 * ViewTranslationProvider, otherwise `invalidateView` would remove a key the
 * provider never reads and the stale fingerprint would survive.
 *
 * @param viewName - The view identifier (e.g. 'feed', 'product:123')
 * @param locale - The target locale the view was translated into
 * @returns The localStorage key for that view + locale
 */
function viewMetadataKey(viewName: string, locale: string): string {
  return `translation_metadata_${viewName}_${locale}`;
}

/**
 * The invalidator returned by {@link createInvalidator}.
 */
export interface AudarInvalidator {
  /**
   * Evict cached DB translations for a specific content item.
   *
   * Deletes the matching rows via {@link DatabaseAdapter.deleteTranslations}.
   * When `locale` is omitted, rows are deleted across ALL locales for the
   * given content; when provided, only that locale's row is removed.
   *
   * @param contentType - The content type (e.g. 'product_title')
   * @param contentId - The content id
   * @param locale - OPTIONAL target locale; omit to evict all locales
   * @throws Error if the database adapter does not implement
   *   `deleteTranslations`
   */
  invalidate(contentType: string, contentId: string, locale?: string): Promise<void>;

  /**
   * Evict ALL cached DB translations for a given locale.
   *
   * @param locale - The target locale to evict
   * @throws Error if the database adapter does not implement
   *   `deleteTranslations`
   */
  invalidateLocale(locale: string): Promise<void>;

  /**
   * Evict the LOCAL localStorage fingerprint for a view + locale.
   *
   * This removes only the `translation_metadata_${viewName}_${locale}` key so
   * the provider re-checks the DB cache on its next mount. It does NOT touch
   * the database. No-op when localStorage is unavailable (e.g. server-side).
   *
   * @param viewName - The view identifier
   * @param locale - The target locale
   */
  invalidateView(viewName: string, locale: string): void;
}

/**
 * Create a framework-agnostic invalidator bound to an {@link AudarConfig}.
 *
 * @param config - The Audar configuration whose database adapter performs the
 *   DB-side eviction
 * @returns An {@link AudarInvalidator}
 */
export function createInvalidator(config: AudarConfig): AudarInvalidator {
  /**
   * Resolve the adapter's deleteTranslations, throwing a clear, actionable
   * error if the adapter does not implement it. Centralized so both DB-side
   * methods produce the same guidance.
   */
  function requireDeleteTranslations(): NonNullable<
    AudarConfig['database']['deleteTranslations']
  > {
    const del = config.database.deleteTranslations;
    if (typeof del !== 'function') {
      throw new Error(
        'Audar invalidation requires the database adapter to implement ' +
          '`deleteTranslations(filter)`. The configured adapter does not. ' +
          'Implement DatabaseAdapter.deleteTranslations to use invalidate() / ' +
          'invalidateLocale(), or use invalidateView() to clear localStorage only.'
      );
    }
    // Bind to the adapter so the method keeps its `this` context.
    return del.bind(config.database);
  }

  return {
    async invalidate(contentType: string, contentId: string, locale?: string): Promise<void> {
      const deleteTranslations = requireDeleteTranslations();
      // Omit `locale` entirely when not provided so the adapter deletes across
      // all locales (an explicit `locale: undefined` could be mishandled by an
      // adapter that does `'locale' in filter` checks).
      await deleteTranslations({
        contentType,
        contentId,
        ...(locale !== undefined ? { locale } : {}),
      });
    },

    async invalidateLocale(locale: string): Promise<void> {
      const deleteTranslations = requireDeleteTranslations();
      await deleteTranslations({ locale });
    },

    invalidateView(viewName: string, locale: string): void {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(viewMetadataKey(viewName, locale));
    },
  };
}
