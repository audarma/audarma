/**
 * Pure cache helpers for Audarma's progressive translation system.
 *
 * These functions are extracted from ViewTranslationProvider so they can be
 * unit-tested in isolation. The provider imports and uses them directly, so
 * the tested code path IS the production path.
 */

import crypto from 'crypto-js';
import type { TranslationItem } from '../types';

/**
 * Shape of a cached translation row returned by the database adapter.
 */
export interface DbTranslationResult {
  content_type: string;
  content_id: string;
  translated_text: string;
  source_hash: string;
}

/**
 * Compute the view-level content hash.
 *
 * This is a LOCAL localStorage cache key (not cross-mode), so it is
 * intentionally truncated to 16 chars. It is order-independent (sorted)
 * so reordering items does not invalidate the cache.
 *
 * @param items - All translation items in the view
 * @returns A stable 16-char hex hash of the view content
 */
export function computeViewContentHash(items: TranslationItem[]): string {
  const contentString = items
    .map((item) => `${item.contentType}:${item.contentId}:${item.text}`)
    .sort()
    .join('|');
  return crypto.SHA256(contentString).toString().substring(0, 16);
}

/**
 * Canonical per-item source hash.
 *
 * MUST match the CLI's node-crypto hash for the same input:
 *   crypto.createHash('sha256').update(text).digest('hex')
 * Full 64-char hex, NO substring. This is used to decide whether a cached
 * DB row was translated from the current source text or from stale text.
 *
 * @param text - The source (default-locale) text of the item
 * @returns The full 64-char SHA256 hex digest
 */
export function canonicalItemHash(text: string): string {
  return crypto.SHA256(text).toString();
}

/**
 * Build a translation cache map from database results, honoring source_hash.
 *
 * A DB row is a valid cache HIT only if its source_hash equals the current
 * canonical hash of the corresponding item's text. Rows whose source_hash
 * differs (or is missing) are treated as a cache MISS, so the item is added
 * to uncachedItems and will be re-translated and re-saved.
 *
 * @param items - All translation items currently in the view
 * @param dbResults - Cached rows returned by the database adapter
 * @returns A cache map of "contentType:contentId" -> translated text, plus
 *          the list of items that still need translation
 */
export function buildCacheFromDbResults(
  items: TranslationItem[],
  dbResults: DbTranslationResult[]
): { cache: Record<string, string>; uncachedItems: TranslationItem[] } {
  // Index DB rows by content key for O(1) lookup.
  const dbByKey = new Map<string, DbTranslationResult>(
    dbResults.map((r) => [`${r.content_type}:${r.content_id}`, r])
  );

  const cache: Record<string, string> = {};
  const uncachedItems: TranslationItem[] = [];

  items.forEach((item) => {
    const key = `${item.contentType}:${item.contentId}`;
    const row = dbByKey.get(key);

    // Valid hit only when the row exists AND its source_hash matches the
    // current canonical hash of the item's text. Otherwise it is stale or
    // missing -> treat as a miss and re-translate.
    if (row && row.source_hash && row.source_hash === canonicalItemHash(item.text)) {
      cache[key] = row.translated_text;
    } else {
      uncachedItems.push(item);
    }
  });

  return { cache, uncachedItems };
}
