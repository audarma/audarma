import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInvalidator } from '../src/core/invalidation';
import type { AudarConfig, DatabaseAdapter } from '../src/types';

/**
 * Build a minimal AudarConfig for invalidation tests. Only `database` is
 * exercised here; `llm` and `i18n` are stubbed to satisfy the type. When
 * `withDelete` is false, the adapter intentionally omits `deleteTranslations`
 * to exercise the missing-method error path.
 */
function makeConfig(
  deleteTranslations?: DatabaseAdapter['deleteTranslations']
): { config: AudarConfig; deleteSpy?: ReturnType<typeof vi.fn> } {
  const database: DatabaseAdapter = {
    getCachedTranslations: vi.fn(async () => []),
    saveTranslations: vi.fn(async () => {}),
  };

  let deleteSpy: ReturnType<typeof vi.fn> | undefined;
  if (deleteTranslations) {
    deleteSpy = vi.fn(deleteTranslations);
    database.deleteTranslations = deleteSpy as unknown as DatabaseAdapter['deleteTranslations'];
  }

  const config: AudarConfig = {
    database,
    llm: { translateBatch: vi.fn(async () => []) },
    i18n: {
      getCurrentLocale: () => 'ru',
      getDefaultLocale: () => 'en',
      getSupportedLocales: () => ['en', 'ru'],
    },
  };

  return { config, deleteSpy };
}

describe('createInvalidator', () => {
  describe('invalidate(contentType, contentId, locale?)', () => {
    it('calls deleteTranslations with contentType, contentId, and locale when locale is given', async () => {
      const { config, deleteSpy } = makeConfig(async () => {});
      const invalidator = createInvalidator(config);

      await invalidator.invalidate('product_title', '42', 'ru');

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith({
        contentType: 'product_title',
        contentId: '42',
        locale: 'ru',
      });
    });

    it('OMITS the locale key entirely when locale is not provided', async () => {
      const { config, deleteSpy } = makeConfig(async () => {});
      const invalidator = createInvalidator(config);

      await invalidator.invalidate('product_title', '42');

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const filter = deleteSpy!.mock.calls[0][0];
      expect(filter).toEqual({ contentType: 'product_title', contentId: '42' });
      // Explicitly assert the key is absent (not just undefined) so adapters
      // doing `'locale' in filter` checks delete across all locales.
      expect('locale' in filter).toBe(false);
    });

    it('awaits the adapter promise (propagates rejection)', async () => {
      const { config } = makeConfig(async () => {
        throw new Error('db down');
      });
      const invalidator = createInvalidator(config);

      await expect(invalidator.invalidate('product_title', '42', 'ru')).rejects.toThrow(
        'db down'
      );
    });

    it('throws a clear error when the adapter lacks deleteTranslations', async () => {
      const { config } = makeConfig(); // no deleteTranslations
      const invalidator = createInvalidator(config);

      await expect(invalidator.invalidate('product_title', '42', 'ru')).rejects.toThrow(
        /deleteTranslations/
      );
    });
  });

  describe('invalidateLocale(locale)', () => {
    it('calls deleteTranslations with only the locale filter', async () => {
      const { config, deleteSpy } = makeConfig(async () => {});
      const invalidator = createInvalidator(config);

      await invalidator.invalidateLocale('ru');

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith({ locale: 'ru' });
    });

    it('throws a clear error when the adapter lacks deleteTranslations', async () => {
      const { config } = makeConfig();
      const invalidator = createInvalidator(config);

      await expect(invalidator.invalidateLocale('ru')).rejects.toThrow(/deleteTranslations/);
    });
  });

  describe('invalidateView(viewName, locale)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('removes ONLY the matching translation_metadata localStorage key', () => {
      const { config } = makeConfig(async () => {});
      const invalidator = createInvalidator(config);

      const targetKey = 'translation_metadata_feed_ru';
      const otherKey = 'translation_metadata_feed_kk';
      localStorage.setItem(targetKey, JSON.stringify({ contentHash: 'x' }));
      localStorage.setItem(otherKey, JSON.stringify({ contentHash: 'y' }));

      invalidator.invalidateView('feed', 'ru');

      expect(localStorage.getItem(targetKey)).toBeNull();
      // Other view/locale keys are untouched.
      expect(localStorage.getItem(otherKey)).not.toBeNull();
    });

    it('uses the exact key format translation_metadata_${viewName}_${locale}', () => {
      const { config } = makeConfig(async () => {});
      const invalidator = createInvalidator(config);

      // Colon-containing view names (e.g. 'product:123') are passed through verbatim.
      localStorage.setItem('translation_metadata_product:123_kk', 'data');

      invalidator.invalidateView('product:123', 'kk');

      expect(localStorage.getItem('translation_metadata_product:123_kk')).toBeNull();
    });

    it('is a no-op (does not throw) when the key does not exist', () => {
      const { config } = makeConfig(async () => {});
      const invalidator = createInvalidator(config);

      expect(() => invalidator.invalidateView('missing', 'ru')).not.toThrow();
    });

    it('does NOT require deleteTranslations (clears localStorage only)', () => {
      const { config } = makeConfig(); // adapter without deleteTranslations
      const invalidator = createInvalidator(config);

      localStorage.setItem('translation_metadata_feed_ru', 'data');
      expect(() => invalidator.invalidateView('feed', 'ru')).not.toThrow();
      expect(localStorage.getItem('translation_metadata_feed_ru')).toBeNull();
    });
  });
});
