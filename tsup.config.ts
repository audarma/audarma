import { defineConfig } from 'tsup';

/**
 * Three build targets:
 *
 *  1. Library entry (src/index.ts) — ESM + CJS + type declarations. This is
 *     what consumers import from the `audarma` package.
 *
 *  2. Server entry (src/server/index.ts) — ESM + CJS + type declarations,
 *     emitted to dist/server/index.{js,mjs,d.ts}. This is the
 *     Server-Component-safe `audarma/server` subpath. It must NOT bundle the
 *     'use client' provider, so it has its own entry rather than being part of
 *     the main library bundle.
 *
 *  3. CLI entry (cli/translate.ts) — CJS only, with a Node shebang banner so
 *     the emitted file (dist/translate.js) is directly executable via the
 *     `audarma` bin. The CLI uses require()/jiti at runtime, so CJS is the
 *     right format here.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
  },
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    // Do not wipe dist (the library build above already cleaned it).
    clean: false,
    outDir: 'dist',
  },
  {
    entry: { translate: 'cli/translate.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    // Do not wipe dist (the library build above already cleaned it).
    clean: false,
    outDir: 'dist',
    // Make the emitted dist/translate.js directly executable.
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    // 4. Example adapters — published as importable subpaths
    //    (`audarma/adapters/examples/<name>`) via the package "exports" map.
    //    They depend only on global fetch and type-only imports, so they build
    //    standalone with no extra runtime dependencies.
    entry: {
      'adapters/examples/openai-llm-provider': 'src/adapters/examples/openai-llm-provider.ts',
      'adapters/examples/anthropic-llm-provider': 'src/adapters/examples/anthropic-llm-provider.ts',
      'adapters/examples/cerebras-llm-provider': 'src/adapters/examples/cerebras-llm-provider.ts',
      'adapters/examples/nebius-llm-provider': 'src/adapters/examples/nebius-llm-provider.ts',
      'adapters/examples/supabase-adapter': 'src/adapters/examples/supabase-adapter.ts',
      'adapters/examples/next-intl-adapter': 'src/adapters/examples/next-intl-adapter.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
  },
]);
