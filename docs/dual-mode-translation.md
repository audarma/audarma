# Dual-Mode Translation System

Audar supports two complementary translation modes that work together to provide optimal performance and flexibility.

## Overview

| Mode | When | Best For | Speed |
|------|------|----------|-------|
| **Lazy (View-based)** | Runtime (on user visit) | Dynamic content, UGC, long-tail pages | First user waits 3-5s, then instant |
| **CLI (Batch)** | Pre-deployment (command) | Static content, bulk translation, SEO | All users see instant translations |

**Both modes share the same cache table** (`content_translations`), so they complement each other perfectly.

---

## Mode 1: Lazy View-Based Translation

### How It Works

```typescript
// User visits page with untranslated content
<ViewTranslationProvider viewName="products" items={productItems}>
  <ProductCard product={product} />
</ViewTranslationProvider>

// Flow:
// 1. Check cache (might be empty for first visit)
// 2. If missing, translate in background
// 3. Update UI progressively
// 4. Save to cache
// 5. Next user sees instant translation
```

### When to Use

✅ **User-Generated Content**
```typescript
// Chat messages
<ViewTranslationProvider viewName="chat" items={messages}>
  {/* Too dynamic for CLI - translate on-demand */}
</ViewTranslationProvider>
```

✅ **Long-Tail Content**
```typescript
// Rarely-visited product pages
// Don't waste $ translating if nobody views in target language
```

✅ **Rapid Development**
```typescript
// Add 5 products during development
// Don't want to run CLI after each change
// First user in each language triggers translation
```

✅ **No Configuration Needed**
```typescript
// Just wrap views, translations happen automatically
// Zero setup beyond adapter configuration
```

### Pros & Cons

**Pros:**
- ✅ Zero configuration - just use `ViewTranslationProvider`
- ✅ Handles dynamic content (messages, comments, reviews)
- ✅ Pay-as-you-go cost model (only translate what's viewed)
- ✅ No CLI needed

**Cons:**
- ❌ First user in each language waits 3-5s
- ❌ Not ideal for SEO (crawlers see English first)
- ❌ Unpredictable costs (depends on user behavior)
- ❌ Can't pre-translate before launch

---

## Mode 2: CLI Batch Translation

### How It Works

```bash
# Create config file
# audarma.config.ts
export default {
  contentSources: [
    {
      table: 'products',
      idColumn: 'id',
      items: [
        { contentType: 'product_title', textColumn: 'title' },
        { contentType: 'product_description', textColumn: 'description' }
      ]
    }
  ],
  locales: ['ru', 'kk', 'ja']
};

# Run CLI
$ npx audarma translate

# Flow:
# 1. Read config
# 2. Scan source tables (products, categories, etc.)
# 3. Find translation gaps (missing locale combinations)
# 4. Batch translate (20 items at a time)
# 5. Save to cache
# 6. All users see instant translations
```

### When to Use

✅ **Pre-Launch Translation**
```bash
# Translate all 500 products before going live
$ npx audarma translate
✅ Users see instant translations from day 1
```

✅ **Adding New Locale**
```bash
# Business expands to Japan
$ npx audarma translate --locale ja
✅ All content instantly available in Japanese
```

✅ **SEO Optimization**
```bash
# Pre-translate for search engines
$ npx audarma translate
✅ Google crawler sees Russian/Kazakh/Japanese immediately
```

✅ **End-of-Sprint Workflow**
```bash
# Friday 5pm - fill translation gaps
$ npx audarma translate
✅ Clean slate for deployment
```

✅ **High-Traffic Pages**
```bash
# Pre-translate homepage, top 100 products
$ npx audarma translate --types product_title,product_description
✅ No first-user delays on important pages
```

### Pros & Cons

**Pros:**
- ✅ Zero first-user delay - all translations instant
- ✅ SEO-friendly - crawlers see translated content
- ✅ Predictable costs - translate once upfront
- ✅ Complete coverage - no gaps

**Cons:**
- ❌ Requires configuration file
- ❌ Upfront cost for rarely-visited content
- ❌ Needs re-run after bulk content changes
- ❌ Not suitable for user-generated content

---

## Dual-Mode Architecture

### How They Work Together

Both modes use the **same cache table**, creating a seamless hybrid system:

```typescript
// ViewTranslationProvider (lazy mode) - already implemented!
useEffect(() => {
  // 1. Check cache first
  const cached = await database.getCachedTranslations(items, locale);

  if (allItemsCached) {
    // ✅ CLI pre-filled OR previous user translated
    setCache(cached);
    return; // Instant!
  }

  // 2. Only translate missing items
  const missing = items.filter(notInCache);
  if (missing.length > 0) {
    // Lazy mode catches what CLI missed
    const translations = await llm.translateBatch(missing, 'en', locale);
    await database.saveTranslations(translations);
  }
}, [items, locale]);
```

**Cache is shared:**
- CLI writes to `content_translations` table
- Lazy mode reads from `content_translations` table
- Both write to same table (idempotent)
- No conflicts, no duplication

---

## Real-World Workflows

### Workflow 1: Sprint Development

```
Monday:
  Developer adds 10 products
  No CLI run needed

Tuesday 3pm:
  Russian user browses feed
  → Lazy translation: 10 products → Russian
  → Cache now has 10 RU translations

Wednesday:
  Developer adds 8 more products

Thursday 2pm:
  Kazakh user browses feed
  → Lazy translation: 18 products → Kazakh
  → Cache now has 18 KK translations

Friday 5pm (end of sprint):
  $ npm run audarma:translate
  → Finds 18 products missing Japanese
  → Batch translates to JA
  → Cache now complete: 18 products × 3 languages

Result:
  ✅ All languages covered
  ✅ No user saw loading states (lazy caught them)
  ✅ CLI filled final gaps
```

### Workflow 2: Production Launch

```
Before launch:
  Database has 500 products (English only)

  $ npx audarma translate
  → Discovers 500 products
  → Translates to ru, kk, ja
  → 1500 translations cached (500 × 3)
  Cost: ~$2.50

Launch day:
  Users browse in any language
  → Instant translations (cache hit)
  → Zero loading states
  → Zero surprise costs
```

### Workflow 3: Adding New Locale

```
Current state:
  500 products in English, Russian, Kazakh
  Cache: 1000 translations (500 × 2)

Business decision: Expand to Japan

$ npx audarma translate --locale ja
→ Scans 500 products
→ Translates only to Japanese
→ 500 new translations added
→ Cache now: 1500 translations (500 × 3)

Result:
  Japanese users see instant translations
  No impact on Russian/Kazakh (already cached)
```

### Workflow 4: User-Generated Content

```
Chat system:
  CLI doesn't run for messages (too dynamic)

3:00pm: Customer sends message "Where is my order?"
3:05pm: Russian support agent opens chat
        → Lazy translation: "Где мой заказ?"
        → Cached for future agents

3:10pm: Another Russian agent opens same chat
        → Instant translation (cache hit)

Lazy mode handles this automatically
CLI not needed for messages
```

---

## Configuration

### Config File Format

```typescript
// audarma.config.ts
import type { AudarConfig } from 'audarma';

const config: AudarConfig = {
  // Content sources (tables to scan)
  contentSources: [
    {
      table: 'products',
      idColumn: 'id',
      items: [
        {
          contentType: 'product_title',
          textColumn: 'title'
        },
        {
          contentType: 'product_description',
          textColumn: 'description'
        }
      ]
    },
    {
      table: 'categories',
      idColumn: 'id',
      items: [
        {
          contentType: 'category_name',
          textColumn: 'name'
        }
      ]
    }
  ],

  // Target locales
  locales: ['ru', 'kk', 'ja'],

  // Source locale (default: 'en')
  sourceLocale: 'en',

  // Optional: Exclude content types from CLI
  // (Let lazy mode handle these)
  excludeTypes: ['message_text', 'comment_text'],

  // Optional: Batch size (default: 20)
  batchSize: 20
};

export default config;
```

### Advanced: Conditional Content

```typescript
// Only translate published products
{
  table: 'products',
  idColumn: 'id',
  where: { status: 'published' }, // Filter
  items: [
    { contentType: 'product_title', textColumn: 'title' }
  ]
}

// Only translate verified categories
{
  table: 'categories',
  idColumn: 'id',
  where: { is_verified: true },
  items: [
    { contentType: 'category_name', textColumn: 'name' }
  ]
}
```

---

## CLI Commands

### Basic Usage

```bash
# Translate all content to all locales
npx audarma translate

# Translate only to specific locale
npx audarma translate --locale ja

# Translate specific content types
npx audarma translate --types product_title,product_description

# Dry run (show what would be translated)
npx audarma translate --dry-run

# Check translation status
npx audarma status
```

### Output Example

```bash
$ npx audarma translate

🔍 Discovering content...
Found 450 items:
  - 150 products × 2 fields (title, description)
  - 50 categories × 1 field (name)
  - 100 FAQs × 2 fields (question, answer)

🔍 Finding translation gaps...
Found 120 items needing translation:
  - Russian (ru): 40 missing
  - Kazakh (kk): 40 missing
  - Japanese (ja): 40 missing

📝 Translating to Russian (ru)...
  ✅ Batch 1/2: 20 items (product_title, product_description)
  ✅ Batch 2/2: 20 items (category_name, faq_question)
  ✅ 40 translations saved

📝 Translating to Kazakh (kk)...
  ✅ Batch 1/2: 20 items
  ✅ Batch 2/2: 20 items
  ✅ 40 translations saved

📝 Translating to Japanese (ja)...
  ✅ Batch 1/2: 20 items
  ✅ Batch 2/2: 20 items
  ✅ 40 translations saved

✅ Translation complete!

Summary:
  Total items translated: 120
  Total cost: $0.18
  Cache coverage: 100%

Next steps:
  - Deploy with complete translations
  - Lazy mode will handle new content automatically
```

---

## Deployment Strategies

### Strategy 1: Lazy-Only (Simplest)

```json
// package.json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  }
}
```

**When:**
- Small app (<100 products)
- Rapid development
- Mostly user-generated content
- Cost-sensitive (pay per view)

**Trade-offs:**
- First user waits 3-5s per language
- Unpredictable costs

---

### Strategy 2: CLI-Only (Pre-translate Everything)

```json
// package.json
{
  "scripts": {
    "dev": "next dev",
    "build": "npm run audarma:translate && next build",
    "audarma:translate": "audarma translate",
    "start": "next start"
  }
}
```

**When:**
- Large catalog (500+ products)
- SEO is critical
- Predictable costs needed
- High traffic expected

**Trade-offs:**
- Build time increases
- Pays upfront for all content

---

### Strategy 3: Hybrid (Recommended)

```json
// package.json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "predeploy": "npm run audarma:translate",
    "audarma:translate": "audarma translate",
    "start": "next start"
  }
}
```

**When:**
- Production app
- Mix of static + dynamic content
- Want best of both worlds

**How it works:**
1. **Development:** Lazy mode handles translations
2. **Pre-deploy:** CLI fills gaps
3. **Production:** Users see instant translations
4. **Runtime:** Lazy mode catches new content

**Best practice:**
```bash
# Weekly workflow
Monday-Thursday: Develop (lazy mode active)
Friday 5pm: npm run audarma:translate (CLI fills gaps)
Friday 6pm: Deploy (cache pre-filled)
```

---

## Cost Optimization

### Lazy Mode Costs

```typescript
// Cost = (items viewed) × (languages) × ($0.40 per 1M tokens)

// Example: 100 products, 3 languages
// If ALL products viewed by ALL languages:
//   100 products × 3 languages = 300 translations
//   ~$0.05

// If only 20% viewed:
//   20 products × 3 languages = 60 translations
//   ~$0.01
```

### CLI Mode Costs

```typescript
// Cost = (total items) × (languages) × ($0.40 per 1M tokens)

// Example: 500 products, 3 languages
//   500 × 3 = 1500 translations
//   ~$2.50 upfront

// But: Zero runtime translation costs
```

### Hybrid Cost Optimization

```typescript
// Use CLI for high-traffic content
contentSources: [
  {
    table: 'products',
    idColumn: 'id',
    where: { view_count: { gte: 100 } }, // Top 10%
    items: [...]
  }
]

// Let lazy mode handle long-tail
// → 90% of costs covered by top 10% content
// → Remaining 90% content translates on-demand
```

---

## Migration Guide

### From Lazy-Only to Hybrid

**Step 1:** Create config
```typescript
// audarma.config.ts
export default {
  contentSources: [/* ... */],
  locales: ['ru', 'kk', 'ja']
};
```

**Step 2:** Test CLI locally
```bash
npx audarma translate --dry-run  # See what would translate
npx audarma translate             # Actually translate
```

**Step 3:** Check cache
```sql
SELECT locale, COUNT(*)
FROM content_translations
GROUP BY locale;

-- Result:
-- ru: 450
-- kk: 450
-- ja: 450
```

**Step 4:** Add to deployment
```json
{
  "scripts": {
    "predeploy": "npm run audarma:translate"
  }
}
```

**Step 5:** Keep lazy mode active
```typescript
// No changes needed!
// ViewTranslationProvider continues working
// Now with pre-filled cache
```

---

## Troubleshooting

### Issue: CLI not finding content

**Problem:**
```bash
$ npx audarma translate
🔍 Discovering content...
Found 0 items
```

**Solution:**
```typescript
// Check config file path
// Ensure contentSources is exported correctly
export default {
  contentSources: [/* ... */]  // Must have this key
};
```

---

### Issue: Translations not appearing

**Problem:**
```
CLI says "✅ 120 translations saved"
But users still see English
```

**Solution:**
```typescript
// Check cache table
SELECT * FROM content_translations WHERE locale = 'ru' LIMIT 5;

// Check ViewTranslationProvider is using correct contentType
useViewTranslation(
  'product_title',  // Must match CLI config contentType
  product.id,
  product.title
);
```

---

### Issue: Duplicate translations

**Problem:**
```
CLI keeps re-translating same content
```

**Solution:**
```typescript
// CLI checks source_hash before translating
// If content unchanged, skips translation

// Force re-translate:
npx audarma translate --force
```

---

## FAQ

**Q: Can I use CLI without lazy mode?**
A: Yes! Disable ViewTranslationProvider and use only CLI. Users see instant translations but new content won't auto-translate.

**Q: Can I use lazy mode without CLI?**
A: Yes! That's the default. Translations happen on-demand. First user waits, subsequent users instant.

**Q: Do I need both?**
A: No, but recommended for production. CLI pre-fills, lazy catches gaps.

**Q: What happens if I run CLI twice?**
A: It's safe! CLI checks cache first, only translates missing items.

**Q: Can I exclude content from CLI?**
A: Yes! Use `excludeTypes` in config:
```typescript
excludeTypes: ['message_text', 'comment_text']
```

**Q: How do I handle content updates?**
A: CLI detects source_hash changes and re-translates automatically.

**Q: Can I target specific content?**
A: Yes!
```bash
npx audarma translate --types product_title --ids 123,456,789
```

**Q: What about user-generated content?**
A: Always use lazy mode for UGC (messages, comments). CLI can't predict future content.

**Q: How do I add a new locale?**
A:
```bash
# Update config
locales: ['ru', 'kk', 'ja', 'es']  # Add 'es'

# Run CLI for new locale only
npx audarma translate --locale es
```

---

## Summary

| Aspect | Lazy Mode | CLI Mode | Hybrid |
|--------|-----------|----------|--------|
| **Setup** | Zero config | Requires config | Config + lazy |
| **Speed** | 3-5s first user | Instant always | Instant always |
| **Cost** | Pay per view | Upfront bulk | Upfront + gaps |
| **Coverage** | Incremental | Complete | Complete |
| **Dynamic content** | ✅ Yes | ❌ No | ✅ Yes |
| **SEO** | ❌ Poor | ✅ Good | ✅ Good |
| **Best for** | Small apps, UGC | Large catalogs | Production |

**Recommendation:** Start with lazy mode during development, add CLI before production launch.
