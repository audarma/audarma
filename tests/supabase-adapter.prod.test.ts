import { describe, it, expect } from 'vitest';
import { createSupabaseAdapter } from '../src/adapters/examples/supabase-adapter';
import type { ContentSource } from '../src/types/content-sources';

/**
 * Production-shape mock of the supabase-js query builder.
 *
 * Mirrors the hand-rolled `SupabaseClient` interface in the adapter:
 *
 * - `select(columns)` projects each row down to ONLY the requested columns the
 *   way PostgREST does, and the returned builder is BOTH awaitable (a thenable
 *   resolving to `{ data, error }`) AND chainable via `.in()` / `.eq()`.
 * - `.eq(column, value)` records the filter, narrows the rows in memory, and
 *   returns the same chainable+awaitable builder.
 * - `delete()` returns a chainable+awaitable builder whose `.eq()` calls are
 *   recorded so the test can assert the exact filter that was issued.
 *
 * Because `select` projects to only the requested columns, a regression that
 * forgot to select a column would surface here as `undefined`, exactly like
 * the real database.
 */

type Row = Record<string, unknown>;

interface DeleteCall {
  table: string;
  filters: Array<{ column: string; value: unknown }>;
}

function makeMock(tables: Record<string, Row[]>) {
  // Captures every delete() chain so tests can assert the issued filter.
  const deleteCalls: DeleteCall[] = [];

  function selectBuilder(table: string, columns: string) {
    const cols = columns.split(',').map((c) => c.trim());
    const filters: Array<{ column: string; value: unknown }> = [];

    const resolve = () => {
      const all = tables[table] ?? [];
      const matched = all.filter((row) =>
        filters.every((f) => row[f.column] === f.value)
      );
      // Project down to only the selected columns, like PostgREST.
      const data = matched.map((row) =>
        Object.fromEntries(cols.map((c) => [c, row[c]]))
      );
      return { data, error: null as Error | null };
    };

    const builder = {
      in() {
        return Promise.resolve(resolve());
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return builder;
      },
      // Make the builder a thenable so `await builder` resolves the query.
      then<TResult1 = { data: Row[]; error: Error | null }, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: Row[]; error: Error | null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(resolve()).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  function deleteBuilder(table: string) {
    const call: DeleteCall = { table, filters: [] };
    deleteCalls.push(call);

    const builder = {
      eq(column: string, value: unknown) {
        call.filters.push({ column, value });
        return builder;
      },
      then<TResult1 = { data: null; error: Error | null }, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: null; error: Error | null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select: (columns: string) => selectBuilder(table, columns),
        upsert: async () => ({ data: null, error: null }),
        delete: () => deleteBuilder(table),
      };
    },
  };

  return { client, deleteCalls };
}

describe('createSupabaseAdapter.getAllTranslatableContent', () => {
  it('maps rows to { contentType, contentId, text } across multiple items/sources', async () => {
    const { client } = makeMock({
      products: [
        { id: 1, title: 'Hat', description: 'A warm hat' },
        { id: 2, title: 'Boot', description: 'A sturdy boot' },
      ],
      posts: [{ slug: 'hello', body: 'Hello world' }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);

    const sources: ContentSource[] = [
      {
        table: 'products',
        idColumn: 'id',
        items: [
          { contentType: 'product_title', textColumn: 'title' },
          { contentType: 'product_desc', textColumn: 'description' },
        ],
      },
      {
        table: 'posts',
        idColumn: 'slug',
        items: [{ contentType: 'post_body', textColumn: 'body' }],
      },
    ];

    const result = await adapter.getAllTranslatableContent!(sources);

    expect(result).toEqual([
      { contentType: 'product_title', contentId: '1', text: 'Hat' },
      { contentType: 'product_title', contentId: '2', text: 'Boot' },
      { contentType: 'product_desc', contentId: '1', text: 'A warm hat' },
      { contentType: 'product_desc', contentId: '2', text: 'A sturdy boot' },
      { contentType: 'post_body', contentId: 'hello', text: 'Hello world' },
    ]);
  });

  it('applies source-level and per-item WHERE filters (.eq) to narrow rows', async () => {
    const { client } = makeMock({
      products: [
        { id: 1, title: 'Published', status: 'published', featured: true },
        { id: 2, title: 'Draft', status: 'draft', featured: true },
        { id: 3, title: 'Published not featured', status: 'published', featured: false },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);

    const sources: ContentSource[] = [
      {
        table: 'products',
        idColumn: 'id',
        where: { status: 'published' },
        items: [
          {
            contentType: 'product_title',
            textColumn: 'title',
            where: { featured: true },
          },
        ],
      },
    ];

    const result = await adapter.getAllTranslatableContent!(sources);

    // Only id=1 satisfies BOTH status=published (source) and featured=true (item).
    expect(result).toEqual([
      { contentType: 'product_title', contentId: '1', text: 'Published' },
    ]);
  });

  it('skips rows with null/undefined id or empty/non-string text', async () => {
    const { client } = makeMock({
      products: [
        { id: 1, title: 'Keep' },
        { id: null, title: 'No id' },
        { id: 2, title: '' },
        { id: 3, title: 123 },
        { id: 4, title: 'Also keep' },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);

    const result = await adapter.getAllTranslatableContent!([
      {
        table: 'products',
        idColumn: 'id',
        items: [{ contentType: 'product_title', textColumn: 'title' }],
      },
    ]);

    expect(result).toEqual([
      { contentType: 'product_title', contentId: '1', text: 'Keep' },
      { contentType: 'product_title', contentId: '4', text: 'Also keep' },
    ]);
  });

  it('returns [] for empty content sources', async () => {
    const { client } = makeMock({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);
    expect(await adapter.getAllTranslatableContent!([])).toEqual([]);
  });
});

describe('createSupabaseAdapter.deleteTranslations', () => {
  it('issues an .eq() for each provided filter field, mapped to db columns', async () => {
    const { client, deleteCalls } = makeMock({ content_translations: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);

    await adapter.deleteTranslations!({
      contentType: 'product_title',
      contentId: '42',
      locale: 'ru',
    });

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe('content_translations');
    expect(deleteCalls[0].filters).toEqual([
      { column: 'content_type', value: 'product_title' },
      { column: 'content_id', value: '42' },
      { column: 'locale', value: 'ru' },
    ]);
  });

  it('omits unconstrained fields (e.g. deletes a content item across all locales)', async () => {
    const { client, deleteCalls } = makeMock({ content_translations: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);

    await adapter.deleteTranslations!({
      contentType: 'product_title',
      contentId: '42',
    });

    expect(deleteCalls[0].filters).toEqual([
      { column: 'content_type', value: 'product_title' },
      { column: 'content_id', value: '42' },
    ]);
  });

  it('issues an unconstrained delete (no .eq()) for an empty filter', async () => {
    const { client, deleteCalls } = makeMock({ content_translations: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(client as any);

    await adapter.deleteTranslations!({});

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].filters).toEqual([]);
  });

  it('throws when the delete returns an error', async () => {
    const failing = {
      from: () => ({
        delete: () => ({
          eq() {
            return this;
          },
          then(onfulfilled: (v: { data: null; error: Error }) => unknown) {
            return Promise.resolve({ data: null, error: new Error('rls denied') }).then(
              onfulfilled
            );
          },
        }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseAdapter(failing as any);

    await expect(
      adapter.deleteTranslations!({ contentType: 't', contentId: '1', locale: 'ru' })
    ).rejects.toThrow('rls denied');
  });
});
