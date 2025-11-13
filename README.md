# Audarma

> Progressive translation system for React/Next.js with smart caching and view-level translation tracking.

**ALPHA VERSION (0.1.0-alpha.0)** - This is an early extraction from a production app. APIs may change. Contributions welcome!

## What is Audarma?

Audarma (from Kazakh "audar": translate) is a progressive translation system that translates dynamic content (products, messages, user-generated content) using LLMs, with intelligent caching to minimize costs.

Unlike traditional i18n libraries that translate static UI labels, Audarma focuses on **dynamic content translation** - the kind that changes frequently and can't be pre-translated.

## Key Features

- **View-level translation tracking** - Translate entire views at once, not individual strings
- **Smart caching** - Content hash tracking prevents unnecessary re-translations
- **Progressive loading** - Shows original text immediately, translates in background
- **Adapter pattern** - Bring your own database, LLM provider, and i18n library
- **Batch translation** - Groups multiple items into single LLM calls
- **React hooks** - Simple, composable API with loading states
- **Dual-mode operation** - Lazy (on-demand) + CLI (batch pre-translation)

## Translation Modes

Audarma supports two complementary modes that share the same cache:

### Lazy Mode (View-based)
- Translates content on first user visit
- Best for: User-generated content, long-tail pages, rapid development
- Setup: Just wrap views with `ViewTranslationProvider`

### CLI Mode (Batch)
- Pre-translates content before deployment
- Best for: SEO, high-traffic pages, new locale launches
- Setup: Create `audarma.config.ts` and run `npm run translate`

**Use both together** for optimal performance: CLI pre-fills cache, lazy mode catches gaps.

[Read full dual-mode documentation](./docs/dual-mode-translation.md)

## Installation

```bash
npm install audarma
# or
pnpm add audarma
# or
yarn add audarma
```

## Quick Start

### 1. Configure Adapters

Create adapters for your database, LLM provider, and i18n system:

```tsx
// lib/audarma-config.ts
import { AudarConfig } from 'audarma';
import { createSupabaseAdapter } from './adapters/supabase';
import { createNebiusProvider } from './adapters/nebius';
import { useLocale } from 'next-intl';

export function useAudarmaConfig(): AudarConfig {
  const locale = useLocale();

  return {
    database: createSupabaseAdapter(supabaseClient),
    llm: createNebiusProvider({
      apiKey: process.env.NEBIUS_API_KEY!,
      model: 'meta-llama/Llama-3.3-70B-Instruct'
    }),
    i18n: {
      getCurrentLocale: () => locale,
      getDefaultLocale: () => 'en',
      getSupportedLocales: () => ['en', 'es', 'fr', 'de', 'ru', 'ja']
    },
    defaultLocale: 'en',
    debug: true
  };
}
```

### 2. Wrap Your App

```tsx
// app/layout.tsx
import { AudarProvider } from 'audarma';
import { useAudarmaConfig } from '@/lib/audarma-config';

export default function RootLayout({ children }) {
  const config = useAudarmaConfig();

  return (
    <AudarProvider config={config}>
      {children}
    </AudarProvider>
  );
}
```

### 3. Use in Views

```tsx
// app/products/page.tsx
import { ViewTranslationProvider, useViewTranslation } from 'audarma';

function ProductCard({ product }) {
  const { text: title, isTranslating } = useViewTranslation(
    'product_title',
    product.id,
    product.title
  );

  const { text: description } = useViewTranslation(
    'product_description',
    product.id,
    product.description
  );

  return (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      {isTranslating && <span>Translating...</span>}
    </div>
  );
}

export default function ProductsPage({ products }) {
  // Build translation items from your data
  const translationItems = products.flatMap(p => [
    { contentType: 'product_title', contentId: p.id, text: p.title },
    { contentType: 'product_description', contentId: p.id, text: p.description }
  ]);

  return (
    <ViewTranslationProvider viewName="products-feed" items={translationItems}>
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ViewTranslationProvider>
  );
}
```

## Architecture

### Adapter Pattern

Audarma uses three adapter interfaces to remain database and LLM agnostic:

```typescript
interface DatabaseAdapter {
  getCachedTranslations(items: TranslationItem[], targetLocale: string): Promise<...>;
  saveTranslations(translations: Array<...>): Promise<void>;
}

interface LLMProvider {
  translateBatch(items: TranslationItem[], sourceLocale: string, targetLocale: string): Promise<string[]>;
}

interface I18nAdapter {
  getCurrentLocale(): string;
  getDefaultLocale(): string;
  getSupportedLocales(): string[];
}
```

### How It Works

1. **View Mounting** - ViewTranslationProvider calculates content hash from all items
2. **Cache Check** - Checks localStorage metadata to see if view was translated before
3. **Database Query** - Fetches cached translations from database (if any)
4. **LLM Translation** - Translates only missing items via LLM provider
5. **Cache Update** - Saves new translations to database and updates metadata
6. **Re-render** - Components get translated text via `useViewTranslation` hook

### Content Hash Tracking

Audarma tracks whether English content has changed using SHA256 hashes:

- **View Hash** - Hash of all content IDs + texts in a view
- **Item Hash** - Hash of individual item text (stored with translation)

When content changes, only the changed items are re-translated.

## Database Schema

Audarma requires a `content_translations` table:

```sql
CREATE TABLE content_translations (
  content_type TEXT NOT NULL,      -- 'product_title', 'message', etc.
  content_id TEXT NOT NULL,        -- Product ID, message ID, etc.
  locale TEXT NOT NULL,            -- 'es', 'fr', 'ru', etc.
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,       -- SHA256 of original text
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (content_type, content_id, locale)
);

CREATE INDEX idx_content_lookup ON content_translations(content_type, content_id, locale);
CREATE INDEX idx_locale ON content_translations(locale);
```

## Example Adapters

See `/src/adapters/examples/` for reference implementations:

- **Supabase** - PostgreSQL database adapter
- **Nebius** - LLM provider (OpenAI-compatible)
- **next-intl** - I18n adapter for Next.js

You can implement these interfaces for any backend:

- **Databases**: Supabase, Prisma, Drizzle, raw SQL, MongoDB, Redis
- **LLMs**: OpenAI, Anthropic, Google Gemini, local Llama models
- **I18n**: next-intl, react-i18next, FormatJS, custom

## Limitations & Known Issues

This is an **alpha release** extracted from a production app. Here are known limitations:

### Current Limitations

1. **Hard-coded English source** - Currently assumes English as source language
2. **No cache invalidation API** - Must manually delete translations when source text changes
3. **No error boundaries** - Translation errors can crash views
4. **No retry logic** - Failed translations aren't automatically retried
5. **No cost tracking** - No built-in token counting or cost estimation
6. **Client-side only** - Server component support needs work
7. **No streaming** - All translations must complete before returning
8. **No partial updates** - Can't update cache incrementally

### Documented Bugs (Fixed in Production)

These bugs were found and fixed in production. The fixes are documented for your awareness:

- **Bug 1**: LLM included `[content_type]` tags in output
- **Bug 2**: Duplicate insert errors with batch upserts (need deduplication)
- **Bug 3**: next-intl language switching requires full page reload
- **Bug 4**: Old translations had artifact prefixes

## Roadmap

Help us prioritize! Open an issue to vote or propose features.

**Short-term (Community contributions welcome)**

- [ ] Add retry logic with exponential backoff
- [ ] Add error boundaries and fallback UI
- [ ] Add cache invalidation utilities
- [ ] Add OpenAI adapter example
- [ ] Add Prisma adapter example
- [ ] Add cost estimation helpers
- [ ] Add TypeScript strict mode for examples

**Medium-term**

- [ ] Server component support (RSC)
- [ ] Streaming translations (show partial results)
- [ ] Multiple source languages
- [ ] Translation quality scoring
- [ ] A/B testing framework
- [ ] Admin UI for managing translations

**Long-term**

- [ ] Automatic context detection (use surrounding text)
- [ ] Multi-LLM routing (cheap for simple, expensive for complex)
- [ ] Real-time collaborative translation
- [ ] Translation memory (suggest similar translations)

## Contributing

This is an **early alpha release** - we need your help!

**Most valuable contributions:**

1. **Adapter implementations** - Add examples for popular databases/LLMs
2. **Bug fixes** - Fix the known limitations above
3. **Documentation** - Improve examples and guides
4. **Testing** - Add unit/integration tests

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## FAQ

### Why not use static translation files?

Audarma is for **dynamic content** (products, messages, user-generated content) that can't be pre-translated. For static UI labels, use traditional i18n libraries like next-intl or react-i18next.

### How much does it cost?

Depends on your LLM provider and content volume. With smart caching, you only pay once per content item per language. Example: 1,000 products × 5 languages × $0.001/item = $5 total (one-time).

### Does it work with server components?

Not yet. Currently designed for client components. Server component support is on the roadmap.

### Can I use it with my existing i18n setup?

Yes! Audarma is designed to complement existing i18n libraries. Use next-intl/react-i18next for UI labels, and Audarma for dynamic content.

### What if translation quality is bad?

- Try a better LLM model (GPT-4 vs Llama 3.3)
- Improve your prompts in the LLM adapter
- Add context to translation items
- Use translation quality scoring (roadmap feature)

### How do I handle content updates?

Currently, you must manually delete old translations from database. Cache invalidation API is on the roadmap.

## Support

If Audarma saves you time and money, consider supporting development:

[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-pink)](https://github.com/sponsors/eldarski)

## License

MIT © [Eldar Syzdykov](https://github.com/eldarski)

## Links

- [GitHub Repository](https://github.com/audarma/audarma)
- [Issue Tracker](https://github.com/audarma/audarma/issues)
- [npm Package](https://www.npmjs.com/package/audarma)
- [Demo](https://audarma.github.io)

---

Built by [@eldarski](https://github.com/eldarski) to solve real translation challenges in a production marketplace app.
