# AI Coding Agent Installation Guide

This guide helps AI coding agents (Claude, ChatGPT, Cursor, etc.) install and configure Audarma in a user's project.

## Prerequisites Check

Before installation, verify the project has:

1. **React 18+ or 19+**
   ```bash
   # Check React version
   npm list react
   ```

2. **Next.js 14+ or 15+**
   ```bash
   # Check Next.js version
   npm list next
   ```

3. **Database** - One of:
   - PostgreSQL (via Supabase, Prisma, raw SQL)
   - MongoDB
   - Redis
   - Any database with query capability

4. **LLM API Access** - One of:
   - OpenAI API key
   - Anthropic API key
   - Google Gemini API key
   - Nebius/OpenRouter/other OpenAI-compatible API
   - Local LLM (Ollama, llama.cpp)

5. **Existing i18n library** (recommended but optional):
   - next-intl
   - react-i18next
   - FormatJS

## Installation Steps

### Step 1: Install Package

```bash
npm install audarma
# or
pnpm add audarma
# or
yarn add audarma
```

### Step 2: Create Database Table

Create the `content_translations` table in the user's database:

```sql
CREATE TABLE content_translations (
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (content_type, content_id, locale)
);

CREATE INDEX idx_content_lookup ON content_translations(content_type, content_id, locale);
CREATE INDEX idx_locale ON content_translations(locale);
```

**Important**: Adapt the SQL syntax to the user's database:
- PostgreSQL: Use as-is
- MySQL: Change `TIMESTAMPTZ` to `DATETIME`, `TEXT` to `VARCHAR(n)`
- MongoDB: Create collection with compound unique index

### Step 3: Create Database Adapter

Create a file: `lib/adapters/database-adapter.ts`

**For Supabase:**
```typescript
import { DatabaseAdapter, TranslationItem, CachedTranslation } from 'audarma';
import { createClient } from '@supabase/supabase-js';

export function createSupabaseAdapter(supabase: ReturnType<typeof createClient>): DatabaseAdapter {
  return {
    async getCachedTranslations(items: TranslationItem[], targetLocale: string) {
      const keys = items.map(item => ({
        content_type: item.contentType,
        content_id: item.contentId,
        locale: targetLocale
      }));

      const { data, error } = await supabase
        .from('content_translations')
        .select('*')
        .in('content_type', items.map(i => i.contentType))
        .in('content_id', items.map(i => i.contentId))
        .eq('locale', targetLocale);

      if (error) throw error;

      return data.map(row => ({
        contentType: row.content_type,
        contentId: row.content_id,
        translatedText: row.translated_text,
        sourceHash: row.source_hash
      }));
    },

    async saveTranslations(translations: Array<{
      contentType: string;
      contentId: string;
      locale: string;
      originalText: string;
      translatedText: string;
      sourceHash: string;
    }>) {
      const rows = translations.map(t => ({
        content_type: t.contentType,
        content_id: t.contentId,
        locale: t.locale,
        original_text: t.originalText,
        translated_text: t.translatedText,
        source_hash: t.sourceHash
      }));

      const { error } = await supabase
        .from('content_translations')
        .upsert(rows);

      if (error) throw error;
    }
  };
}
```

**For Prisma:**
```typescript
import { DatabaseAdapter } from 'audarma';
import { PrismaClient } from '@prisma/client';

export function createPrismaAdapter(prisma: PrismaClient): DatabaseAdapter {
  return {
    async getCachedTranslations(items, targetLocale) {
      const cached = await prisma.contentTranslation.findMany({
        where: {
          OR: items.map(item => ({
            contentType: item.contentType,
            contentId: item.contentId,
            locale: targetLocale
          }))
        }
      });

      return cached.map(row => ({
        contentType: row.contentType,
        contentId: row.contentId,
        translatedText: row.translatedText,
        sourceHash: row.sourceHash
      }));
    },

    async saveTranslations(translations) {
      await prisma.contentTranslation.createMany({
        data: translations,
        skipDuplicates: true
      });
    }
  };
}
```

### Step 4: Create LLM Provider Adapter

Create a file: `lib/adapters/llm-provider.ts`

**For OpenAI:**
```typescript
import { LLMProvider, TranslationItem } from 'audarma';
import OpenAI from 'openai';

export function createOpenAIProvider(apiKey: string): LLMProvider {
  const openai = new OpenAI({ apiKey });

  return {
    async translateBatch(items: TranslationItem[], sourceLocale: string, targetLocale: string) {
      const prompt = `Translate the following texts from ${sourceLocale} to ${targetLocale}.
Return ONLY a JSON array of translated strings, in the same order.
Do not include any explanations or markdown code blocks.

Texts to translate:
${items.map((item, i) => `${i + 1}. ${item.text}`).join('\n')}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      });

      const content = response.choices[0].message.content || '[]';
      return JSON.parse(content);
    }
  };
}
```

**For Anthropic (Claude):**
```typescript
import { LLMProvider } from 'audarma';
import Anthropic from '@anthropic-ai/sdk';

export function createAnthropicProvider(apiKey: string): LLMProvider {
  const anthropic = new Anthropic({ apiKey });

  return {
    async translateBatch(items, sourceLocale, targetLocale) {
      const prompt = `Translate these texts from ${sourceLocale} to ${targetLocale}.
Return ONLY a JSON array of translations, in order.

${items.map((item, i) => `${i + 1}. ${item.text}`).join('\n')}`;

      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0].text;
      return JSON.parse(content);
    }
  };
}
```

### Step 5: Create Audarma Configuration

Create a file: `lib/audarma-config.ts`

```typescript
import { AudarConfig } from 'audarma';
import { createSupabaseAdapter } from './adapters/database-adapter';
import { createOpenAIProvider } from './adapters/llm-provider';
import { useLocale } from 'next-intl'; // or your i18n library

export function useAudarmaConfig(): AudarConfig {
  const locale = useLocale();

  return {
    database: createSupabaseAdapter(/* your client */),
    llm: createOpenAIProvider(process.env.OPENAI_API_KEY!),
    i18n: {
      getCurrentLocale: () => locale,
      getDefaultLocale: () => 'en',
      getSupportedLocales: () => ['en', 'es', 'fr', 'de', 'ru', 'ja']
    },
    defaultLocale: 'en',
    debug: process.env.NODE_ENV === 'development'
  };
}
```

### Step 6: Wrap Application with Provider

In the root layout file (e.g., `app/layout.tsx`):

```typescript
import { AudarProvider } from 'audarma';
import { useAudarmaConfig } from '@/lib/audarma-config';

export default function RootLayout({ children }) {
  const config = useAudarmaConfig();

  return (
    <html>
      <body>
        <AudarProvider config={config}>
          {children}
        </AudarProvider>
      </body>
    </html>
  );
}
```

### Step 7: Use in Components

Wrap views that need translation:

```typescript
import { ViewTranslationProvider, useViewTranslation } from 'audarma';

function ProductCard({ product }) {
  const { text: title, isTranslating } = useViewTranslation(
    'product_title',
    product.id,
    product.title
  );

  return (
    <div>
      <h3>{title}</h3>
      {isTranslating && <span>Translating...</span>}
    </div>
  );
}

export default function ProductsPage({ products }) {
  const translationItems = products.map(p => ({
    contentType: 'product_title',
    contentId: p.id,
    text: p.title
  }));

  return (
    <ViewTranslationProvider viewName="products" items={translationItems}>
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ViewTranslationProvider>
  );
}
```

## Environment Variables

Add to `.env.local`:

```bash
# Database (example for Supabase)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# LLM Provider (choose one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
```

## Troubleshooting

### "Cannot find module 'audarma'"
- Run `npm install audarma`
- Restart dev server

### "ViewTranslationProvider must be used within AudarProvider"
- Ensure `AudarProvider` wraps the app in root layout
- Check that config is properly passed

### Translations not appearing
- Check browser console for errors
- Verify database table exists and is accessible
- Verify LLM API key is valid
- Enable `debug: true` in config to see logs

### TypeScript errors
- Ensure `@types/react` and `@types/node` are installed
- Check that peer dependencies (React 18+, Next.js 14+) are met

## Verification Steps

After installation, verify everything works:

1. **Start dev server**: `npm run dev`
2. **Open a page** with translated content
3. **Switch language** (via your i18n library)
4. **Check browser console** for Audarma logs (if debug: true)
5. **Check database** for new rows in `content_translations`
6. **Switch back to original language** - should be instant (cached)

## Next Steps

- Read [full documentation](https://github.com/audarma/audarma)
- Explore [example adapters](https://github.com/audarma/audarma/tree/main/src/adapters/examples)
- Consider [CLI mode](https://github.com/audarma/audarma/blob/main/docs/dual-mode-translation.md) for pre-translation

## Support

- [GitHub Issues](https://github.com/audarma/audarma/issues)
- [Discussions](https://github.com/audarma/audarma/discussions)
