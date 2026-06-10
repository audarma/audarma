/**
 * `audarma/server` — Server-Component-safe entry point.
 *
 * Import from this subpath inside Next.js App Router Server Components, Route
 * Handlers, or Server Actions. It deliberately does NOT export the
 * `'use client'` provider, so it stays free of React / client-only concerns.
 *
 * @example
 * ```ts
 * import { translateView } from 'audarma/server';
 *
 * const map = await translateView(config, {
 *   items: products.map((p) => ({ contentType: 'product_title', contentId: p.id, text: p.title })),
 *   targetLocale: 'ru',
 * });
 * // map["product_title:42"] -> translated (or source) text
 * ```
 */

export { translateView } from './translateView';
export type { TranslateViewArgs } from './translateView';
