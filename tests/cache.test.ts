import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  computeViewContentHash,
  canonicalItemHash,
  buildCacheFromDbResults,
} from '../src/core/cache';
import type { DbTranslationResult } from '../src/core/cache';
import type { TranslationItem } from '../src/types';

const item = (contentType: string, contentId: string, text: string): TranslationItem => ({
  contentType,
  contentId,
  text,
});

describe('computeViewContentHash', () => {
  it('is deterministic for the same items', () => {
    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    expect(computeViewContentHash(items)).toBe(computeViewContentHash(items));
  });

  it('is order-independent (same items in different order -> same hash)', () => {
    const a = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const b = [item('title', '2', 'World'), item('title', '1', 'Hello')];
    expect(computeViewContentHash(a)).toBe(computeViewContentHash(b));
  });

  it('changes when any item text changes', () => {
    const before = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const after = [item('title', '1', 'Hello'), item('title', '2', 'World!')];
    expect(computeViewContentHash(after)).not.toBe(computeViewContentHash(before));
  });

  it('returns a 16-char hex (local cache key, intentionally truncated)', () => {
    const hash = computeViewContentHash([item('title', '1', 'Hello')]);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('matches a pinned digest (locks the localStorage cache-key serialization)', () => {
    // Pins the exact serialization format ('contentType:contentId:text',
    // sorted, joined with '|', SHA256, first 16 hex chars). If this format
    // changes, every existing user's localStorage cache silently invalidates
    // across a deploy — this test forces that to be a deliberate, reviewed
    // change rather than an accidental one.
    expect(computeViewContentHash([item('title', '1', 'Hello')])).toBe('d5e731535a339456');
  });
});

describe('canonicalItemHash', () => {
  it('returns a full 64-char hex digest', () => {
    expect(canonicalItemHash('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same input', () => {
    expect(canonicalItemHash('hello')).toBe(canonicalItemHash('hello'));
  });

  it('matches the known SHA256 hex of "hello" (locks the cross-mode contract)', () => {
    // This exact digest is the contract between the provider (crypto-js) and
    // the CLI (node crypto). If either side changes hashing, this breaks.
    expect(canonicalItemHash('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('produces the SAME hex as the CLI node-crypto SHA256 for the same input', () => {
    const inputs = ['hello', 'Привет мир', 'Сәлем әлем', '', 'a longer string with spaces'];
    for (const input of inputs) {
      const cliHash = crypto.createHash('sha256').update(input).digest('hex');
      expect(canonicalItemHash(input)).toBe(cliHash);
    }
  });
});

describe('buildCacheFromDbResults', () => {
  it('treats a row with matching source_hash as a cache hit', () => {
    const items = [item('title', '1', 'Hello')];
    const rows: DbTranslationResult[] = [
      {
        content_type: 'title',
        content_id: '1',
        translated_text: 'Привет',
        source_hash: canonicalItemHash('Hello'),
      },
    ];
    const { cache, uncachedItems } = buildCacheFromDbResults(items, rows);
    expect(cache['title:1']).toBe('Привет');
    expect(uncachedItems).toHaveLength(0);
  });

  it('treats a row with a STALE/mismatched source_hash as a miss', () => {
    const items = [item('title', '1', 'Hello')];
    const rows: DbTranslationResult[] = [
      {
        content_type: 'title',
        content_id: '1',
        translated_text: 'СТАРЫЙ ПЕРЕВОД',
        // hash of the OLD text, no longer matches current item text 'Hello'
        source_hash: canonicalItemHash('Goodbye'),
      },
    ];
    const { cache, uncachedItems } = buildCacheFromDbResults(items, rows);
    expect(cache['title:1']).toBeUndefined();
    expect(uncachedItems).toHaveLength(1);
    expect(uncachedItems[0]).toEqual(items[0]);
  });

  it('treats missing rows as uncached', () => {
    const items = [item('title', '1', 'Hello'), item('title', '2', 'World')];
    const rows: DbTranslationResult[] = [
      {
        content_type: 'title',
        content_id: '1',
        translated_text: 'Привет',
        source_hash: canonicalItemHash('Hello'),
      },
    ];
    const { cache, uncachedItems } = buildCacheFromDbResults(items, rows);
    expect(cache['title:1']).toBe('Привет');
    expect(uncachedItems).toHaveLength(1);
    expect(uncachedItems[0].contentId).toBe('2');
  });

  it('treats a row with an empty source_hash as a miss', () => {
    const items = [item('title', '1', 'Hello')];
    const rows: DbTranslationResult[] = [
      {
        content_type: 'title',
        content_id: '1',
        translated_text: 'Привет',
        source_hash: '',
      },
    ];
    const { cache, uncachedItems } = buildCacheFromDbResults(items, rows);
    expect(cache['title:1']).toBeUndefined();
    expect(uncachedItems).toHaveLength(1);
  });
});
