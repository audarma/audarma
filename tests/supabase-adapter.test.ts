import { describe, it, expect } from 'vitest';
import { createSupabaseAdapter } from '../src/adapters/examples/supabase-adapter';

interface Row {
  content_type: string;
  content_id: string;
  locale: string;
  translated_text: string;
  source_hash: string;
}

/**
 * Minimal mock of the supabase-js query builder used by the adapter.
 *
 * `select(columns)` projects each row down to only the requested columns, the
 * way PostgREST does. This means a regression that drops `locale` from the
 * select string would make `row.locale` undefined here too — so the locale
 * filter test below genuinely guards that `locale` is selected.
 */
function mockSupabase(allRows: Row[]) {
  return {
    from: () => ({
      select: (columns: string) => {
        const cols = columns.split(',').map((c) => c.trim());
        return {
          in: async () => ({
            data: allRows.map((row) =>
              Object.fromEntries(cols.map((c) => [c, (row as Record<string, unknown>)[c]]))
            ),
            error: null,
          }),
        };
      },
      upsert: async () => ({ data: null, error: null }),
    }),
  };
}

const rows: Row[] = [
  { content_type: 'title', content_id: '1', locale: 'ru', translated_text: 'Привет', source_hash: 'h1' },
  { content_type: 'title', content_id: '1', locale: 'kk', translated_text: 'Сәлем', source_hash: 'h1' },
  { content_type: 'title', content_id: '2', locale: 'ru', translated_text: 'Мир', source_hash: 'h2' },
];

describe('createSupabaseAdapter.getCachedTranslations', () => {
  it('returns only rows matching the target locale (locale must be selected & filtered)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(mockSupabase(rows) as any);
    const result = await adapter.getCachedTranslations(
      [{ contentType: 'title', contentId: '1', text: 'Hello' }],
      'ru'
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ content_id: '1', translated_text: 'Привет' });
  });

  it('narrows to the requested (content_type, content_id) pairs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(mockSupabase(rows) as any);
    const result = await adapter.getCachedTranslations(
      [{ contentType: 'title', contentId: '2', text: 'World' }],
      'ru'
    );
    expect(result.map((r) => r.content_id)).toEqual(['2']);
  });

  it('returns [] for an empty item list', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(mockSupabase(rows) as any);
    expect(await adapter.getCachedTranslations([], 'ru')).toEqual([]);
  });
});
