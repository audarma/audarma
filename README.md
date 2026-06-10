# Audarma

> LLM-powered translation system for React/Next.js - translate dynamic content with smart caching.

**ALPHA VERSION** - This is an early extraction from a production app. APIs may change. Contributions welcome! v0.2 adds Server Component support, steerable translations, retries, cache invalidation, observability, and rate-limit-aware batching (see below).

## What is Audarma?

Audarma (from Kazakh "audar": translate) is an **LLM-powered translation system** for dynamic content. It uses Large Language Models (OpenAI, Claude, Gemini, etc.) to translate user-generated content, product descriptions, and messages - with intelligent caching to minimize API costs.

**Traditional i18n libraries** (next-intl, react-i18next) are designed for static UI labels that you translate once.

**Audarma** is designed for **dynamic content** that changes frequently:
- Product catalogs with thousands of items
- User-generated messages and reviews
- Real-time marketplace listings
- Blog posts and articles

With smart caching, you only pay for each translation once - subsequent requests are instant and free.

## Key Features

- **View-level translation tracking** - Translate entire views at once, not individual strings
- **Smart caching** - Content hash tracking prevents unnecessary re-translations
- **Progressive loading** - Shows original text immediately, translates in background
- **Adapter pattern** - Bring your own database, LLM provider, and i18n library
- **Batch translation** - Groups multiple items into single LLM calls
- **React hooks** - Simple, composable API with loading states
- **Dual-mode operation** - Lazy (on-demand) + CLI (batch pre-translation)
- **Server Components** - `translateView` from `audarma/server` for the App Router (no client runtime)
- **Steerable translations** - System prompt, glossary, do-not-translate terms, and formality
- **Production robustness** - Retries with timeouts; failures fall back to source text
- **Cache invalidation** - Programmatic eviction via `createInvalidator` / `useAudarInvalidator`
- **Observability** - `onEvent` callback emitting cache-hit/miss and translate lifecycle events
- **Rate-limit-aware batching** - Bounded batch size, concurrency, and inter-batch interval

## Translation Modes

Audarma supports two complementary modes that share the same cache:

### Lazy Mode (View-based)
- Translates content on first user visit
- Best for: User-generated content, long-tail pages, rapid development
- Setup: Just wrap views with `ViewTranslationProvider`

### CLI Mode (Batch)
- Pre-translates content before deployment
- Best for: SEO, high-traffic pages, new locale launches
- Setup: Create an `audarma.config.ts` that exports `{ config, database, llm }`, then run `npx audarma translate` (supports `--locale=<code>`, `--dry-run`, and `--config=<path>`)

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
    // `defaultLocale` is your content's SOURCE language (content is translated
    // FROM it, and views in this locale render as-is). It can be any locale —
    // it is not restricted to English.
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

## Server Components / App Router

Use `translateView` from the `audarma/server` subpath inside async Server Components, Route Handlers, or Server Actions. It is React-free and has **no** `localStorage` — state lives entirely in the **same DB cache** the lazy provider uses, so a server-side and client-side translation of identical source text share a cache row.

```tsx
// app/products/page.tsx  (Server Component — no 'use client')
import { translateView } from 'audarma/server';
import { config } from '@/lib/audarma-config';

export default async function ProductsPage() {
  const products = await getProducts();

  const map = await translateView(config, {
    items: products.map((p) => ({
      contentType: 'product_title',
      contentId: p.id,
      text: p.title,
    })),
    targetLocale: 'ru',
  });

  return (
    <ul>
      {products.map((p) => (
        // map["product_title:42"] -> translated text (or source text on a miss)
        <li key={p.id}>{map[`product_title:${p.id}`]}</li>
      ))}
    </ul>
  );
}
```

`translateView(config, args)` returns a `Promise<Record<string, string>>` keyed by `"contentType:contentId"`. `args` accepts `items`, `targetLocale`, and optional `sourceLocale` (defaults to `config.defaultLocale`), `viewName` (for observability events, defaults to `'server'`), and per-call `options` (see below). When `targetLocale === sourceLocale` it is a passthrough — no DB query, no LLM call. It **never throws** on an LLM/DB failure: un-translated items fall back to their source text.

## LLM Translation Options

Set `config.translation` to steer every translate request. These directives are forwarded to your `LLMProvider.translateBatch` as the optional **4th argument** (`options: TranslateOptions`). Per-call `options` (e.g. passed to `translateView`) override the config-level directives; when neither is set, providers see the original 3-argument call shape.

```ts
// in your AudarConfig
translation: {
  systemPrompt: 'You are translating an e-commerce marketplace.',
  glossary: { 'sneakers': 'кроссовки' },   // source term -> REQUIRED target translation
  doNotTranslate: ['Audarma', 'iPhone'],    // keep verbatim
  formality: 'formal',                      // 'formal' | 'informal' | 'neutral'
}
```

A provider consumes these via the 4th argument (the bundled example adapters already do this):

```ts
const provider: LLMProvider = {
  async translateBatch(items, sourceLocale, targetLocale, options) {
    const system = [
      options?.systemPrompt,
      options?.formality && `Use a ${options.formality} register.`,
      options?.doNotTranslate?.length &&
        `Keep verbatim: ${options.doNotTranslate.join(', ')}.`,
    ].filter(Boolean).join('\n');
    // ...call your LLM with `system`, `options?.glossary`, and `options?.signal`
    return translatedTexts; // string[] in the same order as `items`
  },
};
```

## Production Robustness

Set `config.retry` to retry failed (or timed-out) translate requests. Defaults preserve the original behavior: `attempts` is `1` (NO retry), and a retry happens **only** on a thrown error or timeout.

```ts
retry: {
  attempts: 3,        // total attempts including the first
  baseDelayMs: 500,   // basis for backoff between attempts
  timeoutMs: 10_000,  // per-attempt timeout; a timeout counts as a thrown error
}
```

When `timeoutMs` is set, an `AbortSignal` is forwarded to your provider via `options.signal` (unless you supplied your own). If all attempts fail, translation **falls back to source text** rather than throwing — both lazy mode and `translateView` degrade gracefully to passthrough.

## Cache Invalidation

Force-evict stale translations without a source-text change. Use the framework-agnostic factory `createInvalidator(config)` (server actions, route handlers, CLI) or the React hook `useAudarInvalidator()` (client components, reads config from `AudarProvider`).

```tsx
import { useAudarInvalidator } from 'audarma';

function AdminControls({ product }) {
  const invalidator = useAudarInvalidator();
  return (
    <button onClick={async () => {
      await invalidator.invalidate('product_title', product.id);        // all locales
      // await invalidator.invalidate('product_title', product.id, 'ru'); // single locale
      // await invalidator.invalidateLocale('ru');                        // whole locale
      invalidator.invalidateView('products-feed', 'ru');                 // localStorage fingerprint only
    }}>
      Refresh translation
    </button>
  );
}
```

- `invalidate(contentType, contentId, locale?)` — delete DB rows for one item (all locales when `locale` is omitted).
- `invalidateLocale(locale)` — delete all DB rows for a locale.
- `invalidateView(viewName, locale)` — clear only the `translation_metadata_${viewName}_${locale}` localStorage key so the provider re-checks the DB on its next mount (no-op server-side).

> `invalidate` and `invalidateLocale` require your database adapter to implement the optional `deleteTranslations(filter)` method; they throw a clear error otherwise. `invalidateView` works without it.

## Observability

Set `config.onEvent` to receive a typed `AudarEvent` for each step of a translation pass:

```ts
onEvent: (event) => {
  switch (event.type) {
    case 'cache_hit':        /* { viewName, locale, count } */ break;
    case 'cache_miss':       /* { viewName, locale, count } */ break;
    case 'translate_start':  /* { viewName, locale, count, batches } */ break;
    case 'translate_success':/* { viewName, locale, count, latencyMs } */ break;
    case 'translate_error':  /* { viewName, locale, attempt, error } */ break;
  }
}
```

Callback errors are swallowed so observability never breaks translation. Note: **token usage and cost are not emitted** — the `LLMProvider.translateBatch` contract returns a plain `string[]` and exposes no usage information.

## Rate-Limit-Aware Batching

Set `config.batching` to split a translate pass into bounded LLM calls. Defaults preserve the original behavior: a single batch containing all items.

```ts
batching: {
  maxBatchSize: 50,          // max items per LLM call
  maxConcurrentBatches: 3,   // batches translated in parallel
  minBatchIntervalMs: 200,   // min interval between batch starts (simple throttle)
}
```

In lazy mode, batches **render progressively** — each batch updates the cache as it resolves, so users see translations stream in rather than waiting for the whole view.

## Architecture

### Adapter Pattern

Audarma uses three adapter interfaces to remain database and LLM agnostic:

```typescript
interface DatabaseAdapter {
  getCachedTranslations(items: TranslationItem[], targetLocale: string): Promise<...>;
  saveTranslations(translations: Array<...>): Promise<void>;
}

interface LLMProvider {
  translateBatch(items: TranslationItem[], sourceLocale: string, targetLocale: string, options?: TranslateOptions): Promise<string[]>;
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

For a production Supabase setup (RLS, policies, and the optional `deleteTranslations` support needed by the invalidation API), see [Supabase production setup](./docs/supabase-setup.md).

## Example Adapters

See `/src/adapters/examples/` for reference implementations:

**Database Adapters:**
- **Supabase** - PostgreSQL database adapter

**LLM Providers:**
- **OpenAI** - GPT-5, GPT-4.1, o4-mini
- **Anthropic** - Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.1
- **Cerebras** - Qwen3-235B, DeepSeek R1 with blazing speed and free daily credits
- **Nebius** - OpenAI-compatible API

**I18n Adapters:**
- **next-intl** - I18n adapter for Next.js

You can implement these interfaces for any backend:

- **Databases**: Supabase, Prisma, Drizzle, raw SQL, MongoDB, Redis
- **LLMs**: OpenAI, Anthropic (Claude), Google Gemini, Cerebras, Nebius, local Llama models
- **I18n**: next-intl, react-i18next, FormatJS, custom

## Limitations & Known Issues

This is an **alpha release** extracted from a production app. Here are known limitations:

### Current Limitations

1. **No error boundaries** - There is no built-in React error boundary (a failed translation falls back to the source text rather than crashing, but render-time errors are not caught)
2. **No cost tracking** - No built-in token counting or cost estimation. The `onEvent` observability hook reports cache hits/misses and translate latency, but not token usage or cost, because `LLMProvider.translateBatch` returns a plain `string[]` with no usage information
3. **No streaming** - Individual LLM batches must complete before their text appears (batches do render progressively via `config.batching`, but a single batch is not streamed token-by-token)
4. **No partial updates** - Can't update cache incrementally

Resolved since the original alpha: manual cache invalidation (`createInvalidator` / `useAudarInvalidator`), retry logic (`config.retry`), Server Component support (`audarma/server`), and observability (`config.onEvent`).

### Documented Bugs (Fixed in Production)

These bugs were found and fixed in production. The fixes are documented for your awareness:

- **Bug 1**: LLM included `[content_type]` tags in output
- **Bug 2**: Duplicate insert errors with batch upserts (need deduplication)
- **Bug 3**: next-intl language switching requires full page reload
- **Bug 4**: Old translations had artifact prefixes

## Roadmap

Help us prioritize! Open an issue to vote or propose features.

**Shipped in v0.2**

- [x] Retry logic with timeouts (`config.retry`)
- [x] Cache invalidation utilities (`createInvalidator` / `useAudarInvalidator`)
- [x] Server Component support (`audarma/server`)
- [x] Observability events (`config.onEvent`)
- [x] Rate-limit-aware batching (`config.batching`)
- [x] Steerable translations (`config.translation`: system prompt, glossary, do-not-translate, formality)
- [x] OpenAI adapter example

**Short-term (Community contributions welcome)**

- [ ] Add error boundaries and fallback UI
- [ ] Add exponential backoff strategy options for retries
- [ ] Add Prisma adapter example
- [ ] Add cost estimation helpers
- [ ] Add TypeScript strict mode for examples

**Medium-term**

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

## Development

```bash
npm install        # install dependencies
npm run build      # build the library + CLI into dist/ (tsup)
npm run type-check # type-check with tsc (no emit)
npm run lint       # lint src/ and cli/ (ESLint flat config)
npm test           # run the test suite (Vitest + jsdom)
npm run test:watch # run tests in watch mode
```

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

Yes. Import `translateView` from `audarma/server` inside async Server Components, Route Handlers, or Server Actions, `await` it, and render the returned `"contentType:contentId"` -> text map. It shares the same DB cache as lazy mode (no `localStorage`, no client runtime). See [Server Components / App Router](#server-components--app-router).

### Can I use it with my existing i18n setup?

Yes! Audarma is designed to complement existing i18n libraries. Use next-intl/react-i18next for UI labels, and Audarma for dynamic content.

### What if translation quality is bad?

- Try a better LLM model (GPT-4 vs Llama 3.3)
- Set `config.translation` to steer output: `systemPrompt`, `glossary`, `doNotTranslate`, and `formality` (see [LLM Translation Options](#llm-translation-options))
- Improve your prompts in the LLM adapter
- Use translation quality scoring (roadmap feature)

### How do I handle content updates?

Content updates are handled automatically. Each cached translation stores a SHA-256 hash of its source text; when the source text changes, the hash no longer matches and the item is re-translated on its next view (lazy mode) or its next CLI run. To force a re-translation *without* a source change, use the invalidation API — `createInvalidator(config)` or the `useAudarInvalidator()` hook — to evict the cached rows. See [Cache Invalidation](#cache-invalidation).

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
