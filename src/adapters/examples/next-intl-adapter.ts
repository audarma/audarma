/**
 * Example next-intl I18n Adapter
 *
 * This is a reference implementation showing how to integrate next-intl
 * with Audar's translation system.
 *
 * Note: This adapter is for CLIENT components only. For server components,
 * you'll need to pass locale explicitly or use a different approach.
 *
 * @example
 * ```ts
 * import { createNextIntlAdapter } from 'audar/adapters/examples/next-intl-adapter';
 *
 * const adapter = createNextIntlAdapter({
 *   supportedLocales: ['en', 'es', 'fr', 'de', 'ru', 'kk', 'ja'],
 *   defaultLocale: 'en'
 * });
 * ```
 */

import type { I18nAdapter } from '../../types';

interface NextIntlConfig {
  supportedLocales: string[];
  defaultLocale: string;
}

/**
 * Creates an i18n adapter for next-intl (client-side only)
 *
 * IMPORTANT: This uses next-intl's useLocale() hook internally, so it
 * only works in client components. For server components, create a
 * server-side adapter that reads locale from cookies/headers.
 */
export function createNextIntlAdapter(config: NextIntlConfig): I18nAdapter {
  const { supportedLocales, defaultLocale } = config;

  return {
    getCurrentLocale() {
      // This would need to import useLocale from next-intl
      // For the package, we'll just throw an error with instructions
      throw new Error(
        'createNextIntlAdapter requires useLocale from next-intl. ' +
        'Please create a custom adapter that wraps useLocale in your app.'
      );
      // In user's app:
      // import { useLocale } from 'next-intl';
      // return useLocale();
    },

    getDefaultLocale() {
      return defaultLocale;
    },

    getSupportedLocales() {
      return supportedLocales;
    },
  };
}

/**
 * Helper to create a next-intl adapter in your app
 *
 * @example
 * ```tsx
 * // In your app code (client component):
 * import { useLocale } from 'next-intl';
 * import { createClientNextIntlAdapter } from 'audar/adapters/examples/next-intl-adapter';
 *
 * function MyApp() {
 *   const locale = useLocale();
 *   const adapter = createClientNextIntlAdapter({
 *     currentLocale: locale,
 *     supportedLocales: ['en', 'es', 'fr'],
 *     defaultLocale: 'en'
 *   });
 *
 *   return <AudarProvider config={{ ...config, i18n: adapter }}>...</AudarProvider>
 * }
 * ```
 */
export function createClientNextIntlAdapter(config: NextIntlConfig & { currentLocale: string }): I18nAdapter {
  const { supportedLocales, defaultLocale, currentLocale } = config;

  return {
    getCurrentLocale() {
      return currentLocale;
    },

    getDefaultLocale() {
      return defaultLocale;
    },

    getSupportedLocales() {
      return supportedLocales;
    },
  };
}
