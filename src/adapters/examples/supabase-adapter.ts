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
 * // Server-side: use the SERVICE ROLE key so writes (saveTranslations /
 * // deleteTranslations) bypass row-level security. See docs/supabase-setup.md.
 * const supabase = createClient(url, serviceRoleKey);
 * const adapter = createSupabaseAdapter(supabase);
 * ```
 */

import type { DatabaseAdapter, TranslationItem } from '../../types';
import type { ContentSource } from '../../types/content-sources';

interface TranslationRow {
  content_type: string;
  content_id: string;
  locale: string;
  translated_text: string;
  source_hash: string;
}

/**
 * Generic PostgREST response envelope: `{ data, error }`.
 */
interface PostgrestResponse<T> {
  data: T | null;
  error: Error | null;
}

/**
 * Shape returned by `select()`.
 *
 * It is awaitable (resolves to the full row set) AND exposes chainable filter
 * builders. `.in()` resolves directly; `.eq()` returns another select filter so
 * equality constraints can be stacked. This mirrors how a real supabase-js
 * query builder is both thenable and chainable.
 */
interface SupabaseSelectFilter<Row>
  extends PromiseLike<PostgrestResponse<Row[]>> {
  in(column: string, values: unknown[]): Promise<PostgrestResponse<Row[]>>;
  eq(column: string, value: unknown): SupabaseSelectFilter<Row>;
}

/**
 * Result of `delete()`. Each `.eq()` narrows the rows to delete and is
 * chainable; awaiting it executes the delete.
 */
interface SupabaseDeleteFilter extends PromiseLike<PostgrestResponse<unknown>> {
  eq(column: string, value: unknown): SupabaseDeleteFilter;
}

/**
 * Minimal, hand-rolled subset of the `@supabase/supabase-js` query builder used
 * by this reference adapter. Modeling only what we call keeps the example
 * dependency-free; a real client from `createClient()` is structurally
 * compatible and can be passed directly.
 */
interface SupabaseClient {
  from(table: string): {
    // `select` is generic so the cache lookup gets `TranslationRow` rows while
    // content discovery gets loosely-typed `Record<string, unknown>` rows.
    select<Row = TranslationRow>(columns: string): SupabaseSelectFilter<Row>;
    upsert(
      data: unknown[],
      options?: { onConflict?: string }
    ): Promise<PostgrestResponse<unknown>>;
    delete(): SupabaseDeleteFilter;
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

    /**
     * Delete cached translation rows matching the filter.
     *
     * Each provided field becomes an equality constraint; an omitted field is
     * left unconstrained (so omitting `locale` deletes matching rows across
     * every locale). An empty filter `{}` issues an unconstrained delete that
     * removes ALL rows — callers should guard against accidental full purges.
     *
     * Requires the service-role key server-side; the RLS policies in
     * docs/supabase-setup.md restrict deletes to that role.
     */
    async deleteTranslations(filter) {
      let query = supabase.from('content_translations').delete();

      if (filter.contentType !== undefined) {
        query = query.eq('content_type', filter.contentType);
      }
      if (filter.contentId !== undefined) {
        query = query.eq('content_id', filter.contentId);
      }
      if (filter.locale !== undefined) {
        query = query.eq('locale', filter.locale);
      }

      const { error } = await query;

      if (error) {
        console.error('[Supabase Adapter] Error deleting translations:', error);
        throw error;
      }
    },

    /**
     * Discover all translatable content from the configured source tables.
     *
     * For each source we issue one `select()` per translatable column (so the
     * projected row carries only the id column + that one text column) and map
     * the rows to `{ contentType, contentId, text }`. Optional `where` filters —
     * at the source level and per item — are applied as equality (`.eq()`)
     * constraints, matching the `Record<string, any>` WHERE shape of
     * `ContentSource`. Per-item filters override source-level filters on the
     * same column.
     *
     * Rows with a null/undefined id or non-string/empty text are skipped so the
     * CLI never tries to hash or translate empty content.
     */
    async getAllTranslatableContent(contentSources) {
      const results: Array<{ contentType: string; contentId: string; text: string }> = [];

      // `contentSources` is typed loosely on the DatabaseAdapter interface; the
      // CLI passes ContentSource[] so we treat it as such for field access.
      const sources = contentSources as ContentSource[];

      for (const source of sources) {
        for (const item of source.items) {
          let query: SupabaseSelectFilter<Record<string, unknown>> = supabase
            .from(source.table)
            .select<Record<string, unknown>>(`${source.idColumn}, ${item.textColumn}`);

          // Apply source-level filters first, then per-item overrides/additions.
          const filters: Record<string, unknown> = {
            ...(source.where ?? {}),
            ...(item.where ?? {}),
          };

          // `.eq()` is chainable; each call narrows the result set further and
          // returns the same filterable builder, which is itself awaitable.
          for (const [column, value] of Object.entries(filters)) {
            query = query.eq(column, value);
          }

          const { data, error } = await query;

          if (error) {
            console.error(
              `[Supabase Adapter] Error reading ${source.table}.${item.textColumn}:`,
              error
            );
            continue;
          }

          for (const row of data ?? []) {
            const id = row[source.idColumn];
            const text = row[item.textColumn];

            if (id === null || id === undefined) {
              continue;
            }
            if (typeof text !== 'string' || text.length === 0) {
              continue;
            }

            results.push({
              contentType: item.contentType,
              contentId: String(id),
              text,
            });
          }
        }
      }

      return results;
    },
  };
}
