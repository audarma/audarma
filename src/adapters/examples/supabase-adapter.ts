/**
 * Example Supabase Database Adapter
 *
 * This is a reference implementation showing how to integrate Supabase
 * with Audarma's translation caching system.
 *
 * @example
 * ```ts
 * import { createClient } from '@supabase/supabase-js';
 * import { createSupabaseAdapter } from 'audarma/adapters/examples/supabase-adapter';
 *
 * const supabase = createClient(url, key);
 * const adapter = createSupabaseAdapter(supabase);
 * ```
 */

import type { DatabaseAdapter, TranslationItem } from '../../types';

interface TranslationRow {
  content_type: string;
  content_id: string;
  locale: string;
  translated_text: string;
  source_hash: string;
}

interface SupabaseClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: unknown[]): Promise<{ data: TranslationRow[] | null; error: Error | null }>;
    };
    upsert(data: unknown[], options?: { onConflict?: string }): Promise<{ data: unknown; error: Error | null }>;
  };
}

export function createSupabaseAdapter(supabase: SupabaseClient): DatabaseAdapter {
  return {
    async getCachedTranslations(items: TranslationItem[], targetLocale: string) {
      if (items.length === 0) {
        return [];
      }

      // Fetch candidate rows by content_id, then narrow to the exact
      // (content_type, content_id) pairs and target locale in memory.
      // NOTE: `locale` MUST be in the selected columns, otherwise the locale
      // filter below compares against undefined and every lookup misses.
      const { data, error } = await supabase
        .from('content_translations')
        .select('content_type, content_id, locale, translated_text, source_hash')
        .in(
          'content_id',
          items.map((item) => item.contentId)
        );

      if (error) {
        console.error('[Supabase Adapter] Error fetching translations:', error);
        return [];
      }

      const wanted = new Set(items.map((item) => `${item.contentType}:${item.contentId}`));
      return (data || []).filter(
        (row) =>
          row.locale === targetLocale &&
          wanted.has(`${row.content_type}:${row.content_id}`)
      );
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
