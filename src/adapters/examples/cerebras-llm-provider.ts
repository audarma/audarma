/**
 * Example Cerebras LLM Provider
 *
 * This adapter integrates Cerebras Inference API with Audarma's translation system.
 * Cerebras offers fast inference and free daily credits, making it ideal for demos.
 *
 * Get API key: https://cloud.cerebras.ai/
 *
 * @example
 * ```ts
 * import { createCerebrasProvider } from 'audarma/adapters/examples/cerebras-llm-provider';
 *
 * const provider = createCerebrasProvider({
 *   apiKey: process.env.CEREBRAS_API_KEY!,
 *   model: 'qwen3-235b', // or 'qwen3-32b', 'deepseek-r1-70b'
 * });
 * ```
 */

import type { LLMProvider, TranslateOptions, TranslationItem } from '../../types';

interface CerebrasConfig {
  apiKey: string;
  model?: string;
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

interface CerebrasMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CerebrasChatCompletion {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export function createCerebrasProvider(config: CerebrasConfig): LLMProvider {
  const {
    apiKey,
    model = 'qwen3-32b',
    temperature = 0.3,
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

      const messages: CerebrasMessage[] = [
        {
          role: 'system',
          content: `${systemContent}${buildDirectiveInstructions(options)}`,
        },
        {
          role: 'user',
          content: JSON.stringify(items.map((item) => item.text)),
        },
      ];

      const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          stream: false,
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cerebras API error: ${response.status} ${error}`);
      }

      const data: CerebrasChatCompletion = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from Cerebras');
      }

      try {
        // Cerebras sometimes wraps response in markdown code blocks, handle that
        const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
        const translations = JSON.parse(cleaned);
        if (!Array.isArray(translations)) {
          throw new Error('Response is not an array');
        }
        return translations;
      } catch (err) {
        throw new Error(`Failed to parse Cerebras response: ${err}`, { cause: err });
      }
    },
  };
}
