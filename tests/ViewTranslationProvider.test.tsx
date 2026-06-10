import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import {
  AudarProvider,
  ViewTranslationProvider,
  useViewTranslation,
  useAudarInvalidator,
} from '../src/core/ViewTranslationProvider';
import { canonicalItemHash, computeViewContentHash } from '../src/core/cache';
import type {
  AudarConfig,
  AudarEvent,
  TranslationItem,
  DatabaseAdapter,
  LLMProvider,
  I18nAdapter,
} from '../src/types';

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

interface MockSetup {
  config: AudarConfig;
  database: {
    getCachedTranslations: ReturnType<typeof vi.fn>;
    saveTranslations: ReturnType<typeof vi.fn>;
  } & DatabaseAdapter;
  llm: { translateBatch: ReturnType<typeof vi.fn> } & LLMProvider;
  i18n: I18nAdapter & { setLocale: (l: string) => void };
}

function makeConfig(opts: {
  currentLocale: string;
  defaultLocale?: string;
  // returns DB rows for getCachedTranslations
  cachedRows?: Array<{
    content_type: string;
    content_id: string;
    translated_text: string;
    source_hash: string;
  }>;
  // maps each uncached item -> translated text
  translate?: (items: TranslationItem[]) => string[];
}): MockSetup {
  let locale = opts.currentLocale;
  const defaultLocale = opts.defaultLocale ?? 'en';

  const getCachedTranslations = vi.fn(async () => opts.cachedRows ?? []);
  const saveTranslations = vi.fn(async () => {});
  const translateBatch = vi.fn(async (items: TranslationItem[]) =>
    opts.translate ? opts.translate(items) : items.map((i) => `[${locale}] ${i.text}`)
  );

  const database = {
    getCachedTranslations,
    saveTranslations,
  } as MockSetup['database'];

  const llm = { translateBatch } as MockSetup['llm'];

  const i18n: MockSetup['i18n'] = {
    getCurrentLocale: () => locale,
    getDefaultLocale: () => defaultLocale,
    getSupportedLocales: () => ['en', 'ru', 'kk'],
    setLocale: (l: string) => {
      locale = l;
    },
  };

  const config: AudarConfig = {
    database,
    llm,
    i18n,
    defaultLocale,
    debug: false,
  };

  return { config, database, llm, i18n };
}

// A tiny consumer that surfaces the translated text into the DOM.
function Consumer({
  contentType,
  contentId,
  text,
  testId = 'out',
}: {
  contentType: string;
  contentId: string;
  text: string;
  testId?: string;
}) {
  const { text: translated, isTranslating } = useViewTranslation(contentType, contentId, text);
  return (
    <span data-testid={testId} data-translating={isTranslating ? 'true' : 'false'}>
      {translated}
    </span>
  );
}

function Harness({
  config,
  items,
  children,
  viewName = 'feed',
}: {
  config: AudarConfig;
  items: TranslationItem[];
  children: ReactNode;
  viewName?: string;
}) {
  return (
    <AudarProvider config={config}>
      <ViewTranslationProvider viewName={viewName} items={items}>
        {children}
      </ViewTranslationProvider>
    </AudarProvider>
  );
}

const item = (contentType: string, contentId: string, text: string): TranslationItem => ({
  contentType,
  contentId,
  text,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 5. Passthrough
// ---------------------------------------------------------------------------

describe('Passthrough (currentLocale === defaultLocale)', () => {
  it('returns the original text and never calls the llm', async () => {
    const { config, llm } = makeConfig({ currentLocale: 'en', defaultLocale: 'en' });
    const items = [item('title', '1', 'Hello')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    expect(screen.getByTestId('out')).toHaveTextContent('Hello');
    // give effects a chance to (not) fire
    await act(async () => {
      await Promise.resolve();
    });
    expect(llm.translateBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Lazy translate
// ---------------------------------------------------------------------------

describe('Lazy translate (non-default locale, empty DB cache)', () => {
  it('calls llm.translateBatch with uncached items, serves translation, and saves', async () => {
    const { config, llm, database } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [],
      translate: (items) => items.map((i) => `RU:${i.text}`),
    });
    const items = [item('title', '1', 'Hello')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('RU:Hello'));

    expect(llm.translateBatch).toHaveBeenCalledTimes(1);
    const [calledItems, src, tgt] = llm.translateBatch.mock.calls[0];
    expect(calledItems).toEqual(items);
    expect(src).toBe('en');
    expect(tgt).toBe('ru');
    expect(database.saveTranslations).toHaveBeenCalledTimes(1);
    const saved = database.saveTranslations.mock.calls[0][0];
    expect(saved[0]).toMatchObject({
      content_type: 'title',
      content_id: '1',
      locale: 'ru',
      original_text: 'Hello',
      translated_text: 'RU:Hello',
      source_hash: canonicalItemHash('Hello'),
    });
  });
});

// ---------------------------------------------------------------------------
// 7. DB cache hit
// ---------------------------------------------------------------------------

describe('DB cache hit (matching source_hash)', () => {
  it('does NOT call llm.translateBatch and serves the cached translation', async () => {
    const { config, llm } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [
        {
          content_type: 'title',
          content_id: '1',
          translated_text: 'Привет (cached)',
          source_hash: canonicalItemHash('Hello'),
        },
      ],
    });
    const items = [item('title', '1', 'Hello')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('Привет (cached)')
    );
    expect(llm.translateBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. REGRESSION Bug 1: text changed, item count unchanged -> re-translate
// ---------------------------------------------------------------------------

describe('REGRESSION Bug 1 (content hash drives re-translation, not items.length)', () => {
  it('re-translates a changed item when item count is unchanged', async () => {
    const { config, llm } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [],
      translate: (items) => items.map((i) => `RU:${i.text}`),
    });

    const itemsV1 = [item('title', '1', 'Hello')];

    const { rerender } = render(
      <Harness config={config} items={itemsV1}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('RU:Hello'));
    expect(llm.translateBatch).toHaveBeenCalledTimes(1);

    // Precondition: the V1 cycle must have completed its localStorage metadata
    // write before we rerender. Without this, V2 could re-translate via the
    // first-visit path (no metadata) rather than the content-change path,
    // making the call-count assertion below pass vacuously even if the effect
    // were (wrongly) keyed off items.length again.
    await waitFor(() =>
      expect(localStorage.getItem('translation_metadata_feed_ru')).not.toBeNull()
    );

    // Same item COUNT (still 1 item), but the TEXT changed. Old behavior keyed
    // the effect off items.length and would NOT re-translate. New behavior keys
    // off the content hash and MUST re-translate.
    const itemsV2 = [item('title', '1', 'Goodbye')];
    rerender(
      <Harness config={config} items={itemsV2}>
        <Consumer contentType="title" contentId="1" text="Goodbye" />
      </Harness>
    );

    await waitFor(() => expect(llm.translateBatch).toHaveBeenCalledTimes(2));
    const secondCallItems = llm.translateBatch.mock.calls[1][0];
    expect(secondCallItems).toEqual([item('title', '1', 'Goodbye')]);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('RU:Goodbye'));
  });
});

// ---------------------------------------------------------------------------
// 9. REGRESSION Bug 2: stale source_hash row -> re-translate, not serve stale
// ---------------------------------------------------------------------------

describe('REGRESSION Bug 2 (stale source_hash treated as miss)', () => {
  it('re-translates an item whose cached row has a stale source_hash', async () => {
    const { config, llm } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [
        {
          content_type: 'title',
          content_id: '1',
          translated_text: 'СТАРЫЙ ПЕРЕВОД',
          // hash of OLD text — no longer matches current 'Hello'
          source_hash: canonicalItemHash('Goodbye'),
        },
      ],
      translate: (items) => items.map((i) => `RU:${i.text}`),
    });
    const items = [item('title', '1', 'Hello')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    // Must re-translate (stale row is a miss), not serve the stale cached text.
    await waitFor(() => expect(llm.translateBatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('RU:Hello'));
    expect(screen.getByTestId('out')).not.toHaveTextContent('СТАРЫЙ ПЕРЕВОД');
  });
});

// ---------------------------------------------------------------------------
// 9b. REGRESSION Bug 2 via the loadFromDatabaseCache recovery path
//     (returning visitor: localStorage metadata present + view hash matches,
//      but a DB row is stale -> must still re-translate, not serve stale)
// ---------------------------------------------------------------------------

describe('REGRESSION Bug 2 (stale row recovered via loadFromDatabaseCache)', () => {
  it('re-translates when metadata matches but a cached row is stale', async () => {
    const items = [item('title', '1', 'Hello')];

    // Pre-seed localStorage so the provider takes the metadata-cache-hit path
    // (metadata.contentHash === current view hash AND itemCount matches),
    // which routes through loadFromDatabaseCache rather than a fresh translate.
    localStorage.setItem(
      'translation_metadata_feed_ru',
      JSON.stringify({
        contentHash: computeViewContentHash(items),
        lastTranslated: new Date().toISOString(),
        locale: 'ru',
        itemCount: items.length,
      })
    );

    const { config, llm } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [
        {
          content_type: 'title',
          content_id: '1',
          translated_text: 'СТАРЫЙ ПЕРЕВОД',
          // stale: hash of OLD text, no longer matches current 'Hello'
          source_hash: canonicalItemHash('Goodbye'),
        },
      ],
      translate: (its) => its.map((i) => `RU:${i.text}`),
    });

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    // The metadata-hit path must NOT serve the stale row; it must fall through
    // to a full translate pass.
    await waitFor(() => expect(llm.translateBatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('RU:Hello'));
    expect(screen.getByTestId('out')).not.toHaveTextContent('СТАРЫЙ ПЕРЕВОД');
  });
});

// ---------------------------------------------------------------------------
// 10. Locale switch clears stale translations
// ---------------------------------------------------------------------------

describe('Locale switch clears stale translations', () => {
  it('clears cache on locale change and re-translates for the new locale', async () => {
    const { config, llm, i18n } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [],
      // translate uses the CURRENT locale via closure in makeConfig default,
      // but we provide explicit prefixes per call here:
      translate: undefined,
    });
    const items = [item('title', '1', 'Hello')];

    const { rerender } = render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('[ru] Hello'));
    expect(llm.translateBatch).toHaveBeenCalledTimes(1);

    // Switch the locale externally, then re-render so the provider polls
    // getCurrentLocale() and detects the change.
    act(() => {
      i18n.setLocale('kk');
    });
    rerender(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    // The new locale produces a different translation; the stale 'ru' text
    // must not persist.
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('[kk] Hello'));
    expect(screen.getByTestId('out')).not.toHaveTextContent('[ru] Hello');
    await waitFor(() => expect(llm.translateBatch).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// 11. Robustness: provider returns fewer translations than requested
// ---------------------------------------------------------------------------

describe('Robustness (provider returns a short/sparse batch)', () => {
  it('persists/caches only valid entries; missing ones fall back to source', async () => {
    const { config, llm, database } = makeConfig({
      currentLocale: 'ru',
      defaultLocale: 'en',
      cachedRows: [],
      // Two items requested, but the provider only returns one translation.
      translate: () => ['RU:First'],
    });
    const items = [item('title', '1', 'First'), item('title', '2', 'Second')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="First" testId="a" />
        <Consumer contentType="title" contentId="2" text="Second" testId="b" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('RU:First'));
    // The second item had no translation -> it falls back to its source text.
    expect(screen.getByTestId('b')).toHaveTextContent('Second');

    // Only the valid translation is persisted — no row with an undefined value.
    expect(database.saveTranslations).toHaveBeenCalledTimes(1);
    const saved = database.saveTranslations.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ content_id: '1', translated_text: 'RU:First' });
  });
});

// ---------------------------------------------------------------------------
// 12. v0.2 — retry on failure (config.retry)
// ---------------------------------------------------------------------------

describe('v0.2 retry (config.retry: provider throws once then succeeds)', () => {
  it('retries translateBatch and renders the item on the second attempt', async () => {
    // First call rejects, second resolves. withRetry(config.retry) must retry.
    let calls = 0;
    const translateBatch = vi.fn(async (items: TranslationItem[]) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('transient LLM failure');
      }
      return items.map((i) => `RU:${i.text}`);
    });

    const config: AudarConfig = {
      database: {
        getCachedTranslations: vi.fn(async () => []),
        saveTranslations: vi.fn(async () => {}),
      },
      llm: { translateBatch },
      i18n: {
        getCurrentLocale: () => 'ru',
        getDefaultLocale: () => 'en',
        getSupportedLocales: () => ['en', 'ru'],
      },
      defaultLocale: 'en',
      // attempts: 2 => one retry. baseDelayMs: 0 keeps the test fast.
      retry: { attempts: 2, baseDelayMs: 0 },
    };

    const items = [item('title', '1', 'Hello')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" />
      </Harness>
    );

    // Renders once the retried attempt succeeds.
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('RU:Hello'));
    // Called twice: the initial failed attempt + the successful retry.
    expect(translateBatch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 13. v0.2 — observability (config.onEvent)
// ---------------------------------------------------------------------------

describe('v0.2 observability (config.onEvent emits cache_miss + translate_success)', () => {
  it('emits cache_miss and translate_success with correct counts', async () => {
    const events: AudarEvent[] = [];

    const config: AudarConfig = {
      database: {
        getCachedTranslations: vi.fn(async () => []),
        saveTranslations: vi.fn(async () => {}),
      },
      llm: {
        translateBatch: vi.fn(async (items: TranslationItem[]) =>
          items.map((i) => `RU:${i.text}`)
        ),
      },
      i18n: {
        getCurrentLocale: () => 'ru',
        getDefaultLocale: () => 'en',
        getSupportedLocales: () => ['en', 'ru'],
      },
      defaultLocale: 'en',
      onEvent: (e) => {
        events.push(e);
      },
    };

    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="Hello" testId="a" />
        <Consumer contentType="title" contentId="2" text="World" testId="b" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('RU:Hello'));
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('RU:World'));

    // cache_miss fires for the 2 uncached items.
    const cacheMiss = events.find((e) => e.type === 'cache_miss');
    expect(cacheMiss).toBeDefined();
    expect(cacheMiss).toMatchObject({
      type: 'cache_miss',
      viewName: 'feed',
      locale: 'ru',
      count: 2,
    });

    // translate_success fires with the count of successfully translated items
    // and a numeric latency.
    const success = events.find((e) => e.type === 'translate_success');
    expect(success).toBeDefined();
    expect(success).toMatchObject({
      type: 'translate_success',
      viewName: 'feed',
      locale: 'ru',
      count: 2,
    });
    expect(typeof (success as { latencyMs: number }).latencyMs).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 14. v0.2 — batching (config.batching.maxBatchSize)
// ---------------------------------------------------------------------------

describe('v0.2 batching (maxBatchSize splits into multiple translateBatch calls)', () => {
  it('splits uncached items into batches and renders all of them', async () => {
    const translateBatch = vi.fn(async (items: TranslationItem[]) =>
      items.map((i) => `RU:${i.text}`)
    );

    const config: AudarConfig = {
      database: {
        getCachedTranslations: vi.fn(async () => []),
        saveTranslations: vi.fn(async () => {}),
      },
      llm: { translateBatch },
      i18n: {
        getCurrentLocale: () => 'ru',
        getDefaultLocale: () => 'en',
        getSupportedLocales: () => ['en', 'ru'],
      },
      defaultLocale: 'en',
      // 3 items, maxBatchSize 1 => 3 separate translateBatch calls.
      batching: { maxBatchSize: 1 },
    };

    const items = [
      item('title', '1', 'One'),
      item('title', '2', 'Two'),
      item('title', '3', 'Three'),
    ];

    render(
      <Harness config={config} items={items}>
        <Consumer contentType="title" contentId="1" text="One" testId="a" />
        <Consumer contentType="title" contentId="2" text="Two" testId="b" />
        <Consumer contentType="title" contentId="3" text="Three" testId="c" />
      </Harness>
    );

    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('RU:One'));
    await waitFor(() => expect(screen.getByTestId('b')).toHaveTextContent('RU:Two'));
    await waitFor(() => expect(screen.getByTestId('c')).toHaveTextContent('RU:Three'));

    // One call per item because maxBatchSize === 1.
    expect(translateBatch).toHaveBeenCalledTimes(3);
    // Each call received exactly one item.
    translateBatch.mock.calls.forEach((call) => {
      expect(call[0]).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 15. v0.2 — useAudarInvalidator
// ---------------------------------------------------------------------------

describe('v0.2 useAudarInvalidator', () => {
  it('invalidate() calls the adapter deleteTranslations with the content filter', async () => {
    const deleteTranslations = vi.fn(async () => {});

    const config: AudarConfig = {
      database: {
        getCachedTranslations: vi.fn(async () => []),
        saveTranslations: vi.fn(async () => {}),
        deleteTranslations,
      },
      llm: {
        translateBatch: vi.fn(async (items: TranslationItem[]) =>
          items.map((i) => i.text)
        ),
      },
      i18n: {
        getCurrentLocale: () => 'ru',
        getDefaultLocale: () => 'en',
        getSupportedLocales: () => ['en', 'ru'],
      },
      defaultLocale: 'en',
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AudarProvider config={config}>{children}</AudarProvider>
    );

    const { result } = renderHook(() => useAudarInvalidator(), { wrapper });

    // Without a locale -> deletes across all locales (no `locale` key).
    await act(async () => {
      await result.current.invalidate('product_title', '42');
    });
    expect(deleteTranslations).toHaveBeenCalledTimes(1);
    expect(deleteTranslations.mock.calls[0][0]).toEqual({
      contentType: 'product_title',
      contentId: '42',
    });

    // With a locale -> constrains to that locale.
    await act(async () => {
      await result.current.invalidate('product_title', '42', 'ru');
    });
    expect(deleteTranslations).toHaveBeenCalledTimes(2);
    expect(deleteTranslations.mock.calls[1][0]).toEqual({
      contentType: 'product_title',
      contentId: '42',
      locale: 'ru',
    });
  });

  it('throws when used outside AudarProvider', () => {
    // Suppress the expected React error boundary console noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAudarInvalidator())).toThrow(
      'ViewTranslationProvider must be used within AudarProvider'
    );
    spy.mockRestore();
  });
});
