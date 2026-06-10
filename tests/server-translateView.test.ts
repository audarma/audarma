import { describe, it, expect, vi } from 'vitest';
import { translateView } from '../src/server';
import { canonicalItemHash } from '../src/core/cache';
import type {
  AudarConfig,
  AudarEvent,
  DatabaseAdapter,
  I18nAdapter,
  LLMProvider,
  TranslationItem,
} from '../src/types';

const item = (contentType: string, contentId: string, text: string): TranslationItem => ({
  contentType,
  contentId,
  text,
});

/** Minimal i18n adapter; defaultLocale is what server falls back to. */
const i18n = (defaultLocale = 'en'): I18nAdapter => ({
  getCurrentLocale: () => defaultLocale,
  getDefaultLocale: () => defaultLocale,
  getSupportedLocales: () => [defaultLocale, 'ru'],
});

interface MakeConfigArgs {
  getCachedTranslations?: DatabaseAdapter['getCachedTranslations'];
  saveTranslations?: DatabaseAdapter['saveTranslations'];
  translateBatch?: LLMProvider['translateBatch'];
  defaultLocale?: string;
  onEvent?: (e: AudarEvent) => void;
  retry?: AudarConfig['retry'];
  translation?: AudarConfig['translation'];
}

function makeConfig(args: MakeConfigArgs = {}): AudarConfig {
  const database: DatabaseAdapter = {
    getCachedTranslations:
      args.getCachedTranslations ?? vi.fn(async () => []),
    saveTranslations: args.saveTranslations ?? vi.fn(async () => {}),
  };
  const llm: LLMProvider = {
    translateBatch:
      args.translateBatch ?? vi.fn(async (items) => items.map((i) => `T(${i.text})`)),
  };
  return {
    database,
    llm,
    i18n: i18n(args.defaultLocale ?? 'en'),
    defaultLocale: args.defaultLocale ?? 'en',
    onEvent: args.onEvent,
    retry: args.retry,
    translation: args.translation,
  };
}

describe('translateView (server entry)', () => {
  it('passthrough when targetLocale === sourceLocale (no DB, no LLM)', async () => {
    const getCachedTranslations = vi.fn(async () => []);
    const translateBatch = vi.fn(async () => []);
    const config = makeConfig({ getCachedTranslations, translateBatch, defaultLocale: 'en' });

    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const map = await translateView(config, { items, targetLocale: 'en' });

    expect(map).toEqual({ 'title:1': 'Hello', 'title:2': 'World' });
    expect(getCachedTranslations).not.toHaveBeenCalled();
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('passthrough when explicit sourceLocale === targetLocale', async () => {
    const translateBatch = vi.fn(async () => []);
    const config = makeConfig({ translateBatch, defaultLocale: 'en' });

    const items = [item('title', '1', 'Bonjour')];
    const map = await translateView(config, {
      items,
      targetLocale: 'fr',
      sourceLocale: 'fr',
    });

    expect(map).toEqual({ 'title:1': 'Bonjour' });
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('cache hit: fresh DB rows are returned without calling the LLM', async () => {
    const items = [item('title', '1', 'Hello')];
    const getCachedTranslations = vi.fn(async () => [
      {
        content_type: 'title',
        content_id: '1',
        translated_text: 'Привет',
        source_hash: canonicalItemHash('Hello'),
      },
    ]);
    const translateBatch = vi.fn(async () => []);
    const config = makeConfig({ getCachedTranslations, translateBatch });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    expect(map).toEqual({ 'title:1': 'Привет' });
    expect(getCachedTranslations).toHaveBeenCalledWith(items, 'ru');
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('miss: LLM is called for uncached items and results are persisted', async () => {
    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const getCachedTranslations = vi.fn(async () => []); // nothing cached
    const saveTranslations = vi.fn(async () => {});
    const translateBatch = vi.fn(async (its: TranslationItem[]) =>
      its.map((i) => `RU(${i.text})`)
    );
    const config = makeConfig({ getCachedTranslations, saveTranslations, translateBatch });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    expect(map).toEqual({ 'title:1': 'RU(Hello)', 'title:2': 'RU(World)' });
    expect(translateBatch).toHaveBeenCalledTimes(1);
    // Source language is config.defaultLocale ('en'), NOT hardcoded.
    expect(translateBatch).toHaveBeenCalledWith(items, 'en', 'ru', undefined);

    expect(saveTranslations).toHaveBeenCalledTimes(1);
    const saved = saveTranslations.mock.calls[0][0];
    expect(saved).toEqual([
      {
        content_type: 'title',
        content_id: '1',
        locale: 'ru',
        original_text: 'Hello',
        translated_text: 'RU(Hello)',
        source_hash: canonicalItemHash('Hello'),
      },
      {
        content_type: 'title',
        content_id: '2',
        locale: 'ru',
        original_text: 'World',
        translated_text: 'RU(World)',
        source_hash: canonicalItemHash('World'),
      },
    ]);
  });

  it('mixed: fresh hit kept, stale source_hash re-translated', async () => {
    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    // title:1 fresh, title:2 stale (hash of OLD text) -> re-translate only #2.
    const getCachedTranslations = vi.fn(async () => [
      {
        content_type: 'title',
        content_id: '1',
        translated_text: 'Привет',
        source_hash: canonicalItemHash('Hello'),
      },
      {
        content_type: 'title',
        content_id: '2',
        translated_text: 'СТАРЫЙ',
        source_hash: canonicalItemHash('Old World'),
      },
    ]);
    const saveTranslations = vi.fn(async () => {});
    const translateBatch = vi.fn(async (its: TranslationItem[]) =>
      its.map((i) => `RU(${i.text})`)
    );
    const config = makeConfig({ getCachedTranslations, saveTranslations, translateBatch });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    expect(map).toEqual({ 'title:1': 'Привет', 'title:2': 'RU(World)' });
    // Only the stale item is sent to the LLM.
    expect(translateBatch).toHaveBeenCalledTimes(1);
    const sentItems = translateBatch.mock.calls[0][0];
    expect(sentItems).toEqual([item('title', '2', 'World')]);
    // Only the re-translated row is persisted.
    const saved = saveTranslations.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].content_id).toBe('2');
    expect(saved[0].translated_text).toBe('RU(World)');
  });

  it('error: LLM throw falls back to source map and does NOT throw or save', async () => {
    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const getCachedTranslations = vi.fn(async () => []);
    const saveTranslations = vi.fn(async () => {});
    const translateBatch = vi.fn(async () => {
      throw new Error('LLM down');
    });
    const config = makeConfig({ getCachedTranslations, saveTranslations, translateBatch });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    // Falls back to source text for the un-translated items.
    expect(map).toEqual({ 'title:1': 'Hello', 'title:2': 'World' });
    expect(saveTranslations).not.toHaveBeenCalled();
  });

  it('sparse provider result: missing entries fall back to source and are not saved', async () => {
    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const getCachedTranslations = vi.fn(async () => []);
    const saveTranslations = vi.fn(async () => {});
    // Provider returns a too-short array (only one translation).
    const translateBatch = vi.fn(async () => ['Привет']);
    const config = makeConfig({ getCachedTranslations, saveTranslations, translateBatch });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    expect(map).toEqual({ 'title:1': 'Привет', 'title:2': 'World' });
    const saved = saveTranslations.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].content_id).toBe('1');
  });

  it('DB read error: treats all as miss, still translates and returns', async () => {
    const items = [item('title', '1', 'Hello')];
    const getCachedTranslations = vi.fn(async () => {
      throw new Error('DB read failed');
    });
    const saveTranslations = vi.fn(async () => {});
    const translateBatch = vi.fn(async (its: TranslationItem[]) =>
      its.map((i) => `RU(${i.text})`)
    );
    const config = makeConfig({ getCachedTranslations, saveTranslations, translateBatch });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    expect(map).toEqual({ 'title:1': 'RU(Hello)' });
    expect(translateBatch).toHaveBeenCalledTimes(1);
  });

  it('sourceLocale defaults to config.defaultLocale (not hardcoded en)', async () => {
    const items = [item('title', '1', 'Hola')];
    const translateBatch = vi.fn(async (its: TranslationItem[]) =>
      its.map((i) => `RU(${i.text})`)
    );
    const config = makeConfig({ translateBatch, defaultLocale: 'es' });

    await translateView(config, { items, targetLocale: 'ru' });

    expect(translateBatch).toHaveBeenCalledWith(items, 'es', 'ru', undefined);
  });

  it('emits the expected AudarEvents on a successful miss', async () => {
    const items = [item('title', '1', 'Hello')];
    const events: AudarEvent[] = [];
    const config = makeConfig({
      getCachedTranslations: vi.fn(async () => []),
      translateBatch: vi.fn(async (its: TranslationItem[]) => its.map((i) => `RU(${i.text})`)),
      onEvent: (e) => events.push(e),
    });

    await translateView(config, { items, targetLocale: 'ru', viewName: 'feed' });

    const types = events.map((e) => e.type);
    expect(types).toContain('cache_miss');
    expect(types).toContain('translate_start');
    expect(types).toContain('translate_success');
    expect(events.every((e) => 'locale' in e && e.locale === 'ru')).toBe(true);
  });

  it('emits translate_error on LLM failure', async () => {
    const items = [item('title', '1', 'Hello')];
    const events: AudarEvent[] = [];
    const config = makeConfig({
      getCachedTranslations: vi.fn(async () => []),
      translateBatch: vi.fn(async () => {
        throw new Error('boom');
      }),
      onEvent: (e) => events.push(e),
    });

    await translateView(config, { items, targetLocale: 'ru' });

    const errEvent = events.find((e) => e.type === 'translate_error');
    expect(errEvent).toBeDefined();
    expect(errEvent && 'attempt' in errEvent && errEvent.attempt).toBe(1);
  });

  it('retry: retries the LLM call and succeeds on a later attempt', async () => {
    const items = [item('title', '1', 'Hello')];
    let calls = 0;
    const translateBatch = vi.fn(async (its: TranslationItem[]) => {
      calls += 1;
      if (calls < 2) throw new Error('transient');
      return its.map((i) => `RU(${i.text})`);
    });
    const config = makeConfig({
      translateBatch,
      retry: { attempts: 2, baseDelayMs: 0 },
    });

    const map = await translateView(config, { items, targetLocale: 'ru' });

    expect(map).toEqual({ 'title:1': 'RU(Hello)' });
    expect(translateBatch).toHaveBeenCalledTimes(2);
  });

  it('forwards merged translation directives as the 4th LLM arg', async () => {
    const items = [item('title', '1', 'Hello')];
    const translateBatch = vi.fn(async (its: TranslationItem[]) => its.map(() => 'X'));
    const config = makeConfig({
      translateBatch,
      translation: { formality: 'formal', doNotTranslate: ['Audarma'] },
    });

    await translateView(config, {
      items,
      targetLocale: 'ru',
      options: { systemPrompt: 'be concise' },
    });

    const passedOptions = translateBatch.mock.calls[0][3];
    expect(passedOptions).toEqual({
      formality: 'formal',
      doNotTranslate: ['Audarma'],
      systemPrompt: 'be concise',
    });
  });
});
