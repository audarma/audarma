# Learnings from Demo Implementation

## Required Package Improvements

### 1. LLMProvider Interface - Already has sourceLocale parameter

**Current implementation in ViewTranslationProvider.tsx line 183-187:**
```typescript
const translatedTexts = await config.llm.translateBatch(
  uncachedItems,
  defaultLocale,  // sourceLocale (2nd parameter)
  locale          // targetLocale (3rd parameter)
);
```

**Parameter order:** `items, sourceLocale, targetLocale`

**Note:** The interface already supports this. All example providers must follow this order.

**Location**: `src/types.ts` - LLMProvider interface should document this clearly

---

### 2. Add Next.js API-based Provider Example

**Why**: Next.js apps can't use API keys directly in client components. Need server-side API route pattern.

**Add file**: `src/adapters/examples/nextjs-api-provider.ts`

```typescript
/**
 * API-based LLM provider for Next.js App Router
 * Use this in client components - routes to your API endpoint
 */

import { LLMProvider, TranslationItem } from 'audarma';

export function createNextJsApiProvider(apiEndpoint = '/api/translate'): LLMProvider {
  return {
    async translateBatch(
      items: TranslationItem[],
      sourceLocale: string,
      targetLocale: string
    ): Promise<string[]> {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, sourceLocale, targetLocale }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Translation API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.translations;
    },
  };
}
```

---

### 3. Add Next.js Documentation Section

**Add to README.md** under "Framework Integration":

#### Next.js App Router

For Next.js apps, use a server-side API route for translations:

**1. Create API route** (`app/api/translate/route.ts`):
```typescript
import { createCerebrasProvider } from 'audarma/adapters/examples';
import type { TranslationItem } from 'audarma';

export async function POST(req: Request) {
  const { items, sourceLocale, targetLocale } = await req.json();

  const apiKey = process.env.CEREBRAS_API_KEY!;
  const provider = createCerebrasProvider(apiKey);

  const translations = await provider.translateBatch(items, targetLocale, sourceLocale);

  return Response.json({ translations });
}
```

**2. Use API provider in client**:
```typescript
'use client';
import { createNextJsApiProvider } from 'audarma/adapters/examples';

export function useAudarmaConfig() {
  return {
    llm: createNextJsApiProvider(),
    // ... other config
  };
}
```

---

### 4. Update All Example Providers

**Fix all provider examples** to accept sourceLocale:
- `openai-llm-provider.ts`
- `anthropic-llm-provider.ts`
- `cerebras-llm-provider.ts`

**Add robust JSON parsing** to handle LLM quirks:
```typescript
// Remove thinking tags, markdown, extract JSON array
let cleaned = content.trim();
cleaned = cleaned.replace(/```json\n?|\n?```/g, '');
cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
if (jsonMatch) {
  cleaned = jsonMatch[0];
}

const translations = JSON.parse(cleaned.trim());
```

This handles cases where models return thinking/reasoning before JSON.

---

### 5. Add Environment Variables Guide

**Add section** to README or create `docs/environment-variables.md`:

#### Client vs Server Environment Variables

**Next.js:**
- Server: Use `.env.local` for API keys (accessible in API routes)
- Client: Prefix with `NEXT_PUBLIC_` only for non-sensitive data
- **Never** expose LLM API keys to the client

**Recommended pattern:**
- API keys → Server-side API routes
- Client → API-based LLM provider
- Cache → localStorage/IndexedDB (client-side)

---

---

### 6. CRITICAL: Next.js Middleware Matcher for Custom Locales

**Issue**: When using custom/fictional language codes (like `tlh` for Klingon, `qya` for Quenya), the Next.js middleware matcher MUST include them or the app will redirect to default locale.

**Problem**: Middleware matcher was hardcoded with old locales:
```typescript
export const config = {
  matcher: ['/', '/(en|es|fr|de|ru|ja)/:path*']  // ❌ Missing new locales!
};
```

**Solution**: Update matcher when adding new locales:
```typescript
export const config = {
  matcher: ['/', '/(en|es|fr|de|kk|ja|la|qya|mis-x-dot|tlh)/:path*']  // ✅
};
```

**Symptoms of this bug:**
- Locale stuck at default (`en`) even after switching
- No translation API calls triggered
- URL changes but content doesn't translate

**Location**: `middleware.ts`

---

### 7. LLM Prompts for Fictional/Constructed Languages

**Issue**: Simple prompts don't work well for fictional languages (Klingon, Dothraki, Quenya, etc.)

**Solution**: Enhanced prompt with:
- Explicit language code explanations
- Creator credits (David J. Peterson, Marc Okrand)
- Permission to think through translations
- Guidance for technical term handling
- **Higher temperature (0.7 instead of 0.3)** for creativity

```typescript
messages: [
  {
    role: 'system',
    content: `You are a professional translator with expertise in both natural and constructed languages.

Language codes:
- "tlh" = Klingon (tlhIngan Hol from Star Trek by Marc Okrand)
- "qya" = Quenya (Sindarin/High Elvish from Tolkien's legendarium)
- "mis-x-dot" = Dothraki (from Game of Thrones by David J. Peterson)

For CONSTRUCTED/FICTIONAL languages:
- Use your deep knowledge of their grammar, vocabulary, phonology
- For modern/technical terms, create naturalistic compounds or loanwords
- Maintain the distinctive style and feel of each language

You may think through your translation process, but ultimately return ONLY a valid JSON array.`
  }
],
temperature: 0.7,  // Higher for creativity with fictional languages
```

**Location**: Cerebras provider (and other LLM providers)

---

### 8. TranslatedText Component Pattern

**Useful pattern** for translating static UI text:

```typescript
// components/translated-text.tsx
export function TranslatedText({ id, text, as = 'span', className, style }) {
  const { text: translated } = useViewTranslation('ui', id, text);
  return <Component className={className} style={style}>{translated}</Component>;
}

// Usage:
<TranslatedText
  id="header_title"
  text="Audarma Demo"
  as="h1"
  className="text-2xl font-bold"
/>
```

---

### 9. Debug Logging in API Provider

**Add logging** to troubleshoot translation issues:

```typescript
export function createApiLLMProvider(): LLMProvider {
  return {
    async translateBatch(items, sourceLocale, targetLocale) {
      console.log(`[API Provider] Translating ${items.length} items from ${sourceLocale} to ${targetLocale}`);

      // ... fetch logic ...

      console.log(`[API Provider] Received ${data.translations?.length} translations`);
      console.log('[API Provider] Sample:', data.translations?.[0]);

      return data.translations;
    }
  };
}
```

---

### 10. CRITICAL BUG FIX: Locale Caching Issue in ViewTranslationProvider

**Status**: ✅ **FIXED** in commit [current]

**Issue**: When users switched languages, the ViewTranslationProvider would return cached translations from the previous language instead of translating to the new locale.

**Root Cause**:
The `getCurrentLocale()` function was called **once** at component mount (line 88) and the value was captured in a constant:
```typescript
const locale = config.i18n.getCurrentLocale(); // ❌ Called once, never updates
```

Even though `locale` was in the useEffect dependency array, React doesn't know when the i18n library's internal state changes. The `config` object stays the same, but `getCurrentLocale()` returns a different value after locale changes.

**Symptoms**:
1. User translates to Kazakh (kk)
2. User switches to German (de)
3. Expected: German translations
4. Actual Bug: Kazakh translations still shown

**The Fix**:
1. Use React state to track current locale
2. Add a separate useEffect that polls for locale changes
3. Clear cache when locale changes
4. Use tracked `currentLocale` state throughout

**Code Changes** (ViewTranslationProvider.tsx):
```typescript
// Before (broken):
const locale = config.i18n.getCurrentLocale(); // Line 88 - called ONCE

// After (fixed):
const [currentLocale, setCurrentLocale] = useState(() => config.i18n.getCurrentLocale());

// Detect locale changes on every render
useEffect(() => {
  const newLocale = config.i18n.getCurrentLocale();
  if (newLocale !== currentLocale) {
    if (config.debug) {
      console.log(`[Audar] Locale changed from ${currentLocale} to ${newLocale} - clearing cache`);
    }
    setCurrentLocale(newLocale);
    setCache({}); // Clear stale translations
    setIsTranslating(false);
  }
});

// Main translation effect now uses currentLocale
useEffect(() => {
  if (currentLocale === defaultLocale || items.length === 0) {
    // ... translation logic ...
  }
}, [viewName, currentLocale, items.length]); // currentLocale triggers re-translation
```

**Why This Works**:
- The locale detection effect runs on every render
- When `useLocale()` from next-intl returns a new value, it triggers a re-render
- The detection effect sees the new locale and updates state
- State change triggers the main translation effect with the new locale
- Cache is cleared to prevent showing stale translations

**Testing**:
1. Load page in English (en)
2. Switch to Kazakh (kk) → should translate
3. Switch to German (de) → should show German, not Kazakh
4. Switch back to Kazakh → should load from cache (instant)
5. Switch to English → should show original text

**Files Modified**:
- `src/core/ViewTranslationProvider.tsx` (lines 88-107, 111, 126-127, 169, 201, 208, 223, 233, 252, 264, 277, 280, 286)

---

## Summary of Changes Needed

- [ ] Update `LLMProvider` interface documentation (parameter order already correct)
- [ ] Add `nextjs-api-provider.ts` example with debug logging
- [ ] Update all existing provider examples (OpenAI, Anthropic, Cerebras)
- [ ] Add robust JSON parsing to all providers (handle thinking tags)
- [ ] Add Next.js section to README with:
  - API route pattern
  - **Middleware matcher warning for custom locales** ⚠️
  - Environment variables security guide
- [ ] Add fictional language translation guide:
  - Enhanced prompts with creator credits
  - Higher temperature settings
  - Technical term handling
- [ ] Add `TranslatedText` component example for UI text
- [ ] Update INSTALL_GUIDE.md with framework-specific patterns
- [x] **Fix locale caching bug in ViewTranslationProvider** ✅ (See #10 above)
