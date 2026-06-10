#!/usr/bin/env node
/**
 * Audar CLI - Batch Translation Command
 *
 * Pre-translates content in bulk by scanning database tables
 * and filling translation gaps.
 *
 * Usage:
 *   npx audarma translate
 *   npx audarma translate --locale ja
 *   npx audarma translate --dry-run
 */

import crypto from 'crypto';
import type {
  DatabaseAdapter,
  LLMProvider,
  TranslationItem,
} from '../src/types';
import type {
  AudarCLIConfig,
  DiscoveredContent,
  TranslationGap,
} from '../src/types/content-sources';

interface CLIOptions {
  dryRun?: boolean;
  locale?: string;
  types?: string[];
  force?: boolean;
  config?: string;
}

/**
 * Discover all translatable content from configured sources
 */
async function discoverContent(
  config: AudarCLIConfig,
  database: DatabaseAdapter
): Promise<DiscoveredContent[]> {
  console.log('🔍 Discovering content...');

  const allContent: DiscoveredContent[] = [];

  // Check if database adapter supports content discovery
  if (!database.getAllTranslatableContent) {
    throw new Error(
      'DatabaseAdapter does not support CLI mode. ' +
      'Please implement getAllTranslatableContent() method.'
    );
  }

  // Get all content from adapter
  const items = await database.getAllTranslatableContent(config.contentSources);

  // Convert to DiscoveredContent format
  for (const item of items) {
    // Skip excluded types
    if (config.excludeTypes?.includes(item.contentType)) {
      continue;
    }

    // Calculate canonical source hash (full 64-char hex, NO truncation).
    // Must match the provider's crypto.SHA256(text).toString() exactly so
    // that CLI-mode and lazy-mode produce identical hashes for the same text.
    const sourceHash = crypto
      .createHash('sha256')
      .update(item.text)
      .digest('hex');

    allContent.push({
      contentType: item.contentType,
      contentId: item.contentId,
      text: item.text,
      sourceHash,
    });
  }

  console.log(`Found ${allContent.length} items`);

  // Show breakdown by content type
  const breakdown = allContent.reduce((acc, item) => {
    acc[item.contentType] = (acc[item.contentType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [type, count] of Object.entries(breakdown)) {
    console.log(`  - ${type}: ${count}`);
  }

  return allContent;
}

/**
 * A single cached translation row, as returned by
 * DatabaseAdapter.getCachedTranslations (only the fields needed for gap
 * detection).
 */
type CachedRow = {
  content_type: string;
  content_id: string;
  source_hash: string;
};

/**
 * Pure gap-computation logic (no IO — fully testable).
 *
 * For each content item, determine — per target locale — whether a *valid*
 * cached translation already exists. A cached row counts as present only if
 * its source_hash equals the item's canonical sourceHash (staleness check):
 * if the source text changed, the old cached row no longer matches and the
 * locale is treated as missing.
 *
 * @param content - Discovered content items (each carries its canonical sourceHash)
 * @param cachedByLocale - Map of locale -> cached rows for that locale
 * @param targetLocales - Locales to check for gaps
 * @returns One TranslationGap per item that is missing at least one locale
 */
export function computeGaps(
  content: DiscoveredContent[],
  cachedByLocale: Record<string, CachedRow[]>,
  targetLocales: string[]
): TranslationGap[] {
  // Build a per-locale lookup of `${content_type}:${content_id}` -> source_hash
  // so each item/locale check is O(1) instead of scanning the cache array.
  const indexByLocale: Record<string, Map<string, string>> = {};
  for (const locale of targetLocales) {
    const index = new Map<string, string>();
    for (const row of cachedByLocale[locale] ?? []) {
      index.set(`${row.content_type}:${row.content_id}`, row.source_hash);
    }
    indexByLocale[locale] = index;
  }

  const gaps: TranslationGap[] = [];

  for (const item of content) {
    const key = `${item.contentType}:${item.contentId}`;
    const missingLocales: string[] = [];

    for (const locale of targetLocales) {
      const cachedHash = indexByLocale[locale].get(key);
      // Missing if there is no cached row for this locale, or the cached row
      // is stale (its source_hash no longer matches the current source text).
      if (cachedHash === undefined || cachedHash !== item.sourceHash) {
        missingLocales.push(locale);
      }
    }

    if (missingLocales.length > 0) {
      gaps.push({
        ...item,
        missingLocales,
      });
    }
  }

  return gaps;
}

/**
 * Find translation gaps (content missing translations for locales).
 *
 * Handles the IO (querying the cache once *per* target locale) and delegates
 * the gap math to the pure computeGaps() helper.
 */
async function findTranslationGaps(
  content: DiscoveredContent[],
  locales: string[],
  database: DatabaseAdapter,
  targetLocale?: string
): Promise<TranslationGap[]> {
  console.log('\n🔍 Finding translation gaps...');

  const targetLocales = targetLocale ? [targetLocale] : locales;

  const items = content.map(c => ({
    contentType: c.contentType,
    contentId: c.contentId,
    text: c.text,
  }));

  // Query the cache once per target locale (the previous implementation only
  // queried the first locale and incorrectly applied that result to all
  // locales).
  const cachedByLocale: Record<string, CachedRow[]> = {};
  for (const locale of targetLocales) {
    cachedByLocale[locale] = await database.getCachedTranslations(items, locale);
  }

  const gaps = computeGaps(content, cachedByLocale, targetLocales);

  console.log(`Found ${gaps.length} items needing translation`);

  // Show breakdown by locale
  const localeBreakdown = gaps.reduce((acc, gap) => {
    for (const locale of gap.missingLocales) {
      acc[locale] = (acc[locale] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  for (const [locale, count] of Object.entries(localeBreakdown)) {
    console.log(`  - ${locale}: ${count} missing`);
  }

  return gaps;
}

/**
 * Batch translate items for a specific locale
 */
async function translateBatch(
  gaps: TranslationGap[],
  locale: string,
  sourceLocale: string,
  llm: LLMProvider,
  database: DatabaseAdapter,
  batchSize: number
): Promise<number> {
  const itemsForLocale = gaps.filter(g => g.missingLocales.includes(locale));

  if (itemsForLocale.length === 0) {
    return 0;
  }

  console.log(`\n📝 Translating to ${locale}...`);

  let totalTranslated = 0;
  const batches = Math.ceil(itemsForLocale.length / batchSize);

  for (let i = 0; i < itemsForLocale.length; i += batchSize) {
    const batch = itemsForLocale.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`  ✨ Batch ${batchNumber}/${batches}: ${batch.length} items...`);

    // Prepare items for translation
    const translationItems: TranslationItem[] = batch.map(item => ({
      contentType: item.contentType,
      contentId: item.contentId,
      text: item.text,
    }));

    try {
      // Translate batch
      const translations = await llm.translateBatch(
        translationItems,
        sourceLocale,
        locale
      );

      // Save to database
      const translationsToSave = batch.map((item, idx) => ({
        content_type: item.contentType,
        content_id: item.contentId,
        locale,
        original_text: item.text,
        translated_text: translations[idx],
        source_hash: item.sourceHash,
      }));

      await database.saveTranslations(translationsToSave);

      totalTranslated += translations.length;
      console.log(`  ✅ Batch ${batchNumber}/${batches}: ${translations.length} translations saved`);
    } catch (error) {
      console.error(`  ❌ Batch ${batchNumber}/${batches} failed:`, error);
      throw error;
    }
  }

  return totalTranslated;
}

/**
 * Main CLI translation function
 */
export async function runTranslation(
  config: AudarCLIConfig,
  database: DatabaseAdapter,
  llm: LLMProvider,
  options: CLIOptions = {}
): Promise<void> {
  const startTime = Date.now();

  console.log('🚀 Audar Batch Translation\n');

  // Step 1: Discover content
  const content = await discoverContent(config, database);

  if (content.length === 0) {
    console.log('\n✅ No content found. Nothing to translate.');
    return;
  }

  // Step 2: Find gaps
  const gaps = await findTranslationGaps(
    content,
    config.locales,
    database,
    options.locale
  );

  if (gaps.length === 0) {
    console.log('\n✅ No translation gaps found. All content is up to date!');
    return;
  }

  // Dry run check
  if (options.dryRun) {
    console.log('\n🔍 DRY RUN - No translations will be performed');
    console.log(`\nWould translate ${gaps.length} items to:`);
    const locales = options.locale ? [options.locale] : config.locales;
    for (const locale of locales) {
      const count = gaps.filter(g => g.missingLocales.includes(locale)).length;
      console.log(`  - ${locale}: ${count} items`);
    }
    return;
  }

  // Step 3: Translate by locale
  const sourceLocale = config.sourceLocale || 'en';
  const batchSize = config.batchSize || 20;
  const targetLocales = options.locale ? [options.locale] : config.locales;

  let totalTranslated = 0;

  for (const locale of targetLocales) {
    const translated = await translateBatch(
      gaps,
      locale,
      sourceLocale,
      llm,
      database,
      batchSize
    );
    totalTranslated += translated;
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Translation complete!\n`);
  console.log(`Summary:`);
  console.log(`  Total items translated: ${totalTranslated}`);
  console.log(`  Duration: ${duration}s`);
  console.log(`  Locales: ${targetLocales.join(', ')}`);
  console.log(`\nNext steps:`);
  console.log(`  - Deploy with complete translations`);
  console.log(`  - Lazy mode will handle new content automatically`);
}

/**
 * Shape a user config module must provide (default- or named-exported).
 */
interface LoadedConfigModule {
  config: AudarCLIConfig;
  database: DatabaseAdapter;
  llm: LLMProvider;
}

/**
 * Load the user config module (TS or JS) at runtime using jiti, so users can
 * author `audarma.config.ts` with full TypeScript and imports.
 */
function loadConfigModule(resolvedConfigPath: string): LoadedConfigModule {
  // jiti compiles TS/ESM on the fly so the CJS CLI bundle can require a
  // TypeScript config file.
  const { createJiti } = require('jiti');
  const jiti = createJiti(__filename);
  const mod = jiti(resolvedConfigPath);
  const loaded = (mod && mod.default) ?? mod;

  if (!loaded || typeof loaded !== 'object') {
    throw new Error(
      `Config at ${resolvedConfigPath} did not export an object. ` +
      'Expected a default (or named) export of { config, database, llm }.'
    );
  }

  const missing: string[] = [];
  if (!loaded.config) missing.push('config');
  if (!loaded.database) missing.push('database');
  if (!loaded.llm) missing.push('llm');

  if (missing.length > 0) {
    throw new Error(
      `Config at ${resolvedConfigPath} is missing required export(s): ${missing.join(', ')}.\n` +
      'Your config must export { config: AudarCLIConfig, database: DatabaseAdapter, llm: LLMProvider }.'
    );
  }

  return loaded as LoadedConfigModule;
}

/**
 * CLI entry point
 */
export async function main() {
  const path = require('path') as typeof import('path');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    locale: args.find(a => a.startsWith('--locale='))?.split('=')[1],
    config: args.find(a => a.startsWith('--config='))?.split('=')[1] || './audarma.config.ts',
  };

  try {
    // Load config file
    const configPath = options.config || './audarma.config.ts';
    const resolvedConfigPath = path.resolve(process.cwd(), configPath);
    console.log(`📋 Loading config from ${resolvedConfigPath}...`);

    let loaded: LoadedConfigModule;
    try {
      loaded = loadConfigModule(resolvedConfigPath);
    } catch (loadError) {
      throw new Error(
        `Failed to load config from ${resolvedConfigPath}.\n` +
        `${loadError instanceof Error ? loadError.message : loadError}\n` +
        'Create an audarma.config.ts that exports { config, database, llm }.\n' +
        'See audarma/docs/dual-mode-translation.md for examples.',
        { cause: loadError }
      );
    }

    await runTranslation(loaded.config, loaded.database, loaded.llm, options);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (require.main === module) {
  main();
}
