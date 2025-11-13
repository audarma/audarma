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

import type { LLMProvider, TranslationItem } from '../../types';

interface OpenAIConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  baseURL?: string;
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
      targetLocale: string
    ): Promise<string[]> {
      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following texts from ${sourceLocale} to ${targetLocale}. Return ONLY a JSON array of translated strings, in the same order as the input. Do not include any explanations, markdown formatting, or code blocks.`,
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
          response_format: { type: 'json_object' },
        }),
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
        throw new Error(`Failed to parse OpenAI response: ${err}`);
      }
    },
  };
}
