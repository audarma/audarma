/**
 * Example Nebius LLM Provider
 *
 * This is a reference implementation showing how to integrate Nebius Studio
 * (OpenAI-compatible API) with Audar's translation system.
 *
 * @example
 * ```ts
 * import { createNebiusProvider } from 'audar/adapters/examples/nebius-llm-provider';
 *
 * const provider = createNebiusProvider({
 *   apiKey: process.env.NEBIUS_API_KEY,
 *   model: 'meta-llama/Llama-3.3-70B-Instruct',
 *   baseUrl: 'https://api.studio.nebius.com/v1/'
 * });
 * ```
 */

import type { LLMProvider, TranslationItem } from '../../types';

interface NebiusConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

export function createNebiusProvider(config: NebiusConfig): LLMProvider {
  const {
    apiKey,
    model = 'meta-llama/Llama-3.3-70B-Instruct',
    baseUrl = 'https://api.studio.nebius.com/v1/',
    temperature = 0.3,
  } = config;

  return {
    async translateBatch(items: TranslationItem[], sourceLocale: string, targetLocale: string) {
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
- Keep technical terms and brand names unchanged when appropriate

Content to translate:
${itemsList}

Translations:`;

      // Call Nebius API (OpenAI-compatible)
      const response = await fetch(`${baseUrl}chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature,
          max_tokens: 4000,
        }),
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
        const match = line.match(/^\d+[\.\)]\s*(.+)$/);
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
