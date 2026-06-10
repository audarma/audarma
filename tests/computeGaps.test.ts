import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { computeGaps } from '../cli/translate';
import type { DiscoveredContent } from '../src/types/content-sources';

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

const content = (
  contentType: string,
  contentId: string,
  text: string
): DiscoveredContent => ({
  contentType,
  contentId,
  text,
  sourceHash: sha(text),
});

type CachedRow = { content_type: string; content_id: string; source_hash: string };

const cachedRow = (
  contentType: string,
  contentId: string,
  sourceText: string
): CachedRow => ({
  content_type: contentType,
  content_id: contentId,
  source_hash: sha(sourceText),
});

describe('computeGaps (CLI multi-locale gap detection)', () => {
  it('REGRESSION: an item present for ru but absent for kk yields a gap listing ONLY kk', () => {
    const items = [content('title', '1', 'Hello')];
    const cachedByLocale = {
      // 'ru' has a valid (matching) cached translation
      ru: [cachedRow('title', '1', 'Hello')],
      // 'kk' has nothing cached
      kk: [],
    };

    const gaps = computeGaps(items, cachedByLocale, ['ru', 'kk']);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].contentId).toBe('1');
    // The headline multi-locale bug: this must be exactly ['kk'], not ['ru','kk']
    // and not empty. ru is covered, only kk is missing.
    expect(gaps[0].missingLocales).toEqual(['kk']);
  });

  it('a stale source_hash for a locale yields a gap for that locale', () => {
    const items = [content('title', '1', 'Hello')];
    const cachedByLocale = {
      // 'ru' cached row was translated from OLD text -> stale
      ru: [cachedRow('title', '1', 'Goodbye')],
      // 'kk' is fully up to date
      kk: [cachedRow('title', '1', 'Hello')],
    };

    const gaps = computeGaps(items, cachedByLocale, ['ru', 'kk']);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingLocales).toEqual(['ru']);
  });

  it('fully-covered items yield no gap', () => {
    const items = [content('title', '1', 'Hello'), content('title', '2', 'World')];
    const cachedByLocale = {
      ru: [cachedRow('title', '1', 'Hello'), cachedRow('title', '2', 'World')],
      kk: [cachedRow('title', '1', 'Hello'), cachedRow('title', '2', 'World')],
    };

    const gaps = computeGaps(items, cachedByLocale, ['ru', 'kk']);

    expect(gaps).toHaveLength(0);
  });

  it('an item missing from BOTH locales lists both, in target order', () => {
    const items = [content('title', '1', 'Hello')];
    const cachedByLocale = { ru: [], kk: [] };

    const gaps = computeGaps(items, cachedByLocale, ['ru', 'kk']);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingLocales).toEqual(['ru', 'kk']);
  });

  it('handles a missing locale entry in the cache map (treated as all missing)', () => {
    const items = [content('title', '1', 'Hello')];
    // 'kk' key not present at all in cachedByLocale
    const cachedByLocale = { ru: [cachedRow('title', '1', 'Hello')] };

    const gaps = computeGaps(items, cachedByLocale, ['ru', 'kk']);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingLocales).toEqual(['kk']);
  });
});
