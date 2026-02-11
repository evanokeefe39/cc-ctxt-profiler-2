import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['bun:sqlite'],
  },
  {
    entry: ['src/bin/context-diag.ts'],
    format: ['esm'],
    sourcemap: true,
    external: ['bun:sqlite'],
    banner: {
      js: '#!/usr/bin/env bun',
    },
  },
]);
