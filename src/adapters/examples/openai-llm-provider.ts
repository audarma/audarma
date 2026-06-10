/**
 * Example OpenAI LLM Provider
 *
 * This adapter integrates OpenAI's API (GPT-4, GPT-3.5, etc.) with Audarma's translation system.
 *
 * @example
 * ```ts
 * import { createOpenAIProvider } from 'audarma/adapters/examples/openai-llm-provider';
 *
 * const provider = createOpenAIProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-4.1', // or 'gpt-5', 'gpt-4.1-mini', 'o4-mini'
 * });
 * ```
 */

import type { LLMProvider, TranslateOptions, TranslationItem } from '../../types';

interface OpenAIConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  baseURL?: string;
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

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatCompletion {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export function createOpenAIProvider(config: OpenAIConfig): LLMProvider {
  const {
    apiKey,
    model = 'gpt-4.1',
    temperature = 0.3,
    baseURL = 'https://api.openai.com/v1',
  } = config;

  return {
    async translateBatch(
      items: TranslationItem[],
      sourceLocale: string,
      targetLocale: string,
      options?: TranslateOptions
    ): Promise<string[]> {
      // Keep the JSON-array output contract intact (the response parser
      // depends on it); a caller-supplied systemPrompt EXTENDS the default
      // instruction rather than replacing it.
      const defaultSystemPrompt = `You are a professional translator. Translate the following texts from ${sourceLocale} to ${targetLocale}. Return ONLY a JSON array of translated strings, in the same order as the input. Do not include any explanations, markdown formatting, or code blocks.`;
      const systemContent = options?.systemPrompt
        ? `${options.systemPrompt}\n\n${defaultSystemPrompt}`
        : defaultSystemPrompt;

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: `${systemContent}${buildDirectiveInstructions(options)}`,
        },
        {
          role: 'user',
          content: JSON.stringify(items.map((item) => item.text)),
        },
      ];

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          // NOTE: we intentionally do NOT set response_format: { type:
          // 'json_object' } here — that mode forces the response root to be a
          // JSON *object*, but this adapter's prompt asks for (and the parser
          // below expects) a JSON *array*. The prompt already constrains output.
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data: OpenAIChatCompletion = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from OpenAI');
      }

      try {
        const translations = JSON.parse(content);
        if (!Array.isArray(translations)) {
          throw new Error('Response is not an array');
        }
        return translations;
      } catch (err) {
        throw new Error(`Failed to parse OpenAI response: ${err}`, { cause: err });
      }
    },
  };
}
