import { defineConfig } from 'tsup';

/**
 * Two build targets:
 *
 *  1. Library entry (src/index.ts) — ESM + CJS + type declarations. This is
 *     what consumers import from the `audarma` package.
 *
 *  2. CLI entry (cli/translate.ts) — CJS only, with a Node shebang banner so
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
]);
