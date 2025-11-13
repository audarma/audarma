/**
 * Example Supabase Database Adapter
 *
 * This is a reference implementation showing how to integrate Supabase
 * with Audar's translation caching system.
 *
 * @example
 * ```ts
 * import { createClient } from '@supabase/supabase-js';
 * import { createSupabaseAdapter } from 'audar/adapters/examples/supabase-adapter';
 *
 * const supabase = createClient(url, key);
 * const adapter = createSupabaseAdapter(supabase);
 * ```
 */

import type { DatabaseAdapter, TranslationItem } from '../../types';

interface SupabaseClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: any[]): Promise<{ data: any[] | null; error: any }>;
    };
    upsert(data: any[], options?: { onConflict?: string }): Promise<{ data: any; error: any }>;
  };
}

export function createSupabaseAdapter(supabase: SupabaseClient): DatabaseAdapter {
  return {
    async getCachedTranslations(items: TranslationItem[], targetLocale: string) {
      // Build list of (content_type, content_id) pairs to query
      const pairs = items.map((item) => `(${item.contentType},${item.contentId})`);

      if (pairs.length === 0) {
        return [];
      }

      // Query Supabase for cached translations
      const { data, error } = await supabase
        .from('content_translations')
        .select('content_type, content_id, translated_text, source_hash')
        .in(
          '(content_type,content_id)',
          items.map((item) => [item.contentType, item.contentId])
        );

      if (error) {
        console.error('[Supabase Adapter] Error fetching translations:', error);
        return [];
      }

      // Filter by locale (Supabase doesn't support composite key queries easily)
      return (data || []).filter((row: any) => row.locale === targetLocale);
    },

    async saveTranslations(translations) {
      // Deduplicate by (content_type, content_id, locale) to avoid conflicts
      const uniqueTranslations = Array.from(
        new Map(
          translations.map((t) => [`${t.content_type}:${t.content_id}:${t.locale}`, t])
        ).values()
      );

      // Upsert to Supabase
      const { error } = await supabase
        .from('content_translations')
        .upsert(uniqueTranslations, {
          onConflict: 'content_type,content_id,locale',
        });

      if (error) {
        console.error('[Supabase Adapter] Error saving translations:', error);
        throw error;
      }
    },
  };
}
