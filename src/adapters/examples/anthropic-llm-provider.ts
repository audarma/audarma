/**
 * Example Anthropic (Claude) LLM Provider
 *
 * This adapter integrates Anthropic's Claude API with Audarma's translation system.
 *
 * @example
 * ```ts
 * import { createAnthropicProvider } from 'audarma/adapters/examples/anthropic-llm-provider';
 *
 * const provider = createAnthropicProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   model: 'claude-sonnet-4.5-20250929', // or 'claude-haiku-4.5', 'claude-opus-4.1'
 * });
 * ```
 */

import type { LLMProvider, TranslateOptions, TranslationItem } from '../../types';

interface AnthropicConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Build additional instruction lines from the optional per-call directives.
 * Returns an empty string when no directives are provided, so the prompt is
 * byte-for-byte identical to the original behavior.
 */
function buildDirectiveInstructions(options?: TranslateOptions): string {
  if (!options) {
    return '';
  }

  const lines: string[] = [];

  if (options.glossary && Object.keys(options.glossary).length > 0) {
    const pairs = Object.entries(options.glossary)
      .map(([term, translation]) => `"${term}" -> "${translation}"`)
      .join(', ');
    lines.push(
      `Use these exact translations for the following terms: ${pairs}.`
    );
  }

  if (options.doNotTranslate && options.doNotTranslate.length > 0) {
    lines.push(
      `Keep the following terms verbatim (do NOT translate them): ${options.doNotTranslate.join(', ')}.`
    );
  }

  if (options.formality) {
    lines.push(`Use a ${options.formality} register/formality in the translation.`);
  }

  if (lines.length === 0) {
    return '';
  }

  return `\n\n${lines.join('\n')}`;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export function createAnthropicProvider(config: AnthropicConfig): LLMProvider {
  const {
    apiKey,
    model = 'claude-sonnet-4.5-20250929',
    maxTokens = 4096,
    temperature = 0.3,
  } = config;

  return {
    async translateBatch(
      items: TranslationItem[],
      sourceLocale: string,
      targetLocale: string,
      options?: TranslateOptions
    ): Promise<string[]> {
      const prompt = `Translate the following texts from ${sourceLocale} to ${targetLocale}.

Input texts (JSON array):
${JSON.stringify(items.map((item) => item.text))}

Return ONLY a JSON array of translated strings, in the same order as the input. Do not include any explanations or markdown formatting.${buildDirectiveInstructions(options)}`;

      const messages: AnthropicMessage[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages,
          // Caller-supplied systemPrompt is forwarded as the top-level
          // Anthropic `system` field; omitted entirely when not provided.
          ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${error}`);
      }

      const data: AnthropicResponse = await response.json();
      const content = data.content[0]?.text;

      if (!content) {
        throw new Error('No response from Anthropic');
      }

      try {
        const translations = JSON.parse(content);
        if (!Array.isArray(translations)) {
          throw new Error('Response is not an array');
        }
        return translations;
      } catch (err) {
        throw new Error(`Failed to parse Anthropic response: ${err}`, { cause: err });
      }
    },
  };
}
