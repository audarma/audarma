/**
 * Example Nebius LLM Provider
 *
 * This is a reference implementation showing how to integrate Nebius Studio
 * (OpenAI-compatible API) with Audarma's translation system.
 *
 * @example
 * ```ts
 * import { createNebiusProvider } from 'audarma/adapters/examples/nebius-llm-provider';
 *
 * const provider = createNebiusProvider({
 *   apiKey: process.env.NEBIUS_API_KEY,
 *   model: 'meta-llama/Llama-3.3-70B-Instruct',
 *   baseUrl: 'https://api.studio.nebius.com/v1/'
 * });
 * ```
 */

import type { LLMProvider, TranslateOptions, TranslationItem } from '../../types';

interface NebiusConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

interface NebiusMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Build additional rule lines from the optional per-call directives. Returns
 * an empty string when no directives are provided, so the prompt is
 * byte-for-byte identical to the original behavior.
 */
function buildDirectiveRules(options?: TranslateOptions): string {
  if (!options) {
    return '';
  }

  const lines: string[] = [];

  if (options.glossary && Object.keys(options.glossary).length > 0) {
    const pairs = Object.entries(options.glossary)
      .map(([term, translation]) => `"${term}" -> "${translation}"`)
      .join(', ');
    lines.push(
      `- Use these exact translations for the following terms: ${pairs}`
    );
  }

  if (options.doNotTranslate && options.doNotTranslate.length > 0) {
    lines.push(
      `- Keep the following terms verbatim (do NOT translate them): ${options.doNotTranslate.join(', ')}`
    );
  }

  if (options.formality) {
    lines.push(`- Use a ${options.formality} register/formality in the translation`);
  }

  if (lines.length === 0) {
    return '';
  }

  return `\n${lines.join('\n')}`;
}

export function createNebiusProvider(config: NebiusConfig): LLMProvider {
  const {
    apiKey,
    model = 'meta-llama/Llama-3.3-70B-Instruct',
    baseUrl = 'https://api.studio.nebius.com/v1/',
    temperature = 0.3,
  } = config;

  return {
    async translateBatch(
      items: TranslationItem[],
      sourceLocale: string,
      targetLocale: string,
      options?: TranslateOptions
    ) {
      // Build prompt with all items
      const itemsList = items
        .map((item, idx) => `${idx + 1}. [${item.contentType}] ${item.text}`)
        .join('\n');

      const prompt = `Translate the following content from ${sourceLocale} to ${targetLocale}.

Rules:
- Return ONLY the translated text for each item
- Keep the numbering (1., 2., 3., etc.)
- Do NOT include [content_type] tags in output
- Preserve formatting and line breaks
- Keep technical terms and brand names unchanged when appropriate${buildDirectiveRules(options)}

Content to translate:
${itemsList}

Translations:`;

      // A caller-supplied systemPrompt is prepended as a system message; when
      // not provided, only the original single user message is sent.
      const messages: NebiusMessage[] = options?.systemPrompt
        ? [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: prompt },
          ]
        : [{ role: 'user', content: prompt }];

      // Call Nebius API (OpenAI-compatible)
      const response = await fetch(`${baseUrl}chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: 4000,
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Nebius API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      const result = data.choices[0]?.message?.content?.trim();

      if (!result) {
        throw new Error('Empty response from Nebius API');
      }

      // Parse numbered list back into array
      const lines = result.split('\n').filter((line: string) => line.trim());
      const translations: string[] = [];

      for (const line of lines) {
        // Match "1. Text here" or "1) Text here"
        const match = line.match(/^\d+[.)]\s*(.+)$/);
        if (match) {
          translations.push(match[1].trim());
        }
      }

      // Ensure we got all translations
      if (translations.length !== items.length) {
        console.warn(
          `[Nebius Provider] Expected ${items.length} translations, got ${translations.length}. Using fallback.`
        );
        // Fallback: return original texts
        return items.map((item) => item.text);
      }

      return translations;
    },
  };
}
