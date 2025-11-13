#!/usr/bin/env node
/**
 * Audar CLI - Batch Translation Command
 *
 * Pre-translates content in bulk by scanning database tables
 * and filling translation gaps.
 *
 * Usage:
 *   npx audar translate
 *   npx audar translate --locale ja
 *   npx audar translate --dry-run
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

    // Calculate source hash
    const sourceHash = crypto
      .createHash('sha256')
      .update(item.text)
      .digest('hex')
      .substring(0, 16);

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
 * Find translation gaps (content missing translations for locales)
 */
async function findTranslationGaps(
  content: DiscoveredContent[],
  locales: string[],
  database: DatabaseAdapter,
  targetLocale?: string
): Promise<TranslationGap[]> {
  console.log('\n🔍 Finding translation gaps...');

  const gaps: TranslationGap[] = [];
  const targetLocales = targetLocale ? [targetLocale] : locales;

  // Get existing translations from cache
  const cachedTranslations = await database.getCachedTranslations(
    content.map(c => ({
      contentType: c.contentType,
      contentId: c.contentId,
      text: c.text,
    })),
    targetLocales[0] // Just check first locale for now (optimize later)
  );

  // Build cache map for quick lookup
  const cacheMap = new Map<string, Set<string>>();
  for (const cached of cachedTranslations) {
    const key = `${cached.content_type}:${cached.content_id}`;
    if (!cacheMap.has(key)) {
      cacheMap.set(key, new Set());
    }
    // We'd need to query each locale separately in real implementation
    // For now, assume we need to check all locales
  }

  // Find gaps for each content item
  for (const item of content) {
    const missingLocales: string[] = [];

    for (const locale of targetLocales) {
      const key = `${item.contentType}:${item.contentId}`;
      const cached = cachedTranslations.find(
        (c: { content_type: string; content_id: string; translated_text: string; source_hash: string }) =>
          c.content_type === item.contentType &&
          c.content_id === item.contentId
      );

      if (!cached || cached.source_hash !== item.sourceHash) {
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
 * CLI entry point
 */
export async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    dryRun: args.includes('--dry-run'),
    locale: args.find(a => a.startsWith('--locale='))?.split('=')[1],
    config: args.find(a => a.startsWith('--config='))?.split('=')[1] || './audar.config.ts',
  };

  try {
    // Load config file
    const configPath = options.config || './audar.config.ts';
    console.log(`📋 Loading config from ${configPath}...`);

    // In a real implementation, we'd dynamically import the config
    // For now, throw an error with instructions
    throw new Error(
      'CLI not yet wired up to config file.\n' +
      'Please use runTranslation() function directly from your code.\n' +
      'See packages/audar/docs/dual-mode-translation.md for examples.'
    );
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (require.main === module) {
  main();
}
