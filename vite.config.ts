import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    sourcemap: true,
    // The harness bundles every transitive dependency into the app, so this
    // package ships zero runtime dependencies; the built file is loaded by the
    // Cordis loader through the package `exports` map.
    deps: { neverBundle: ['node:*'] },
  },
  lint: {
    ignorePatterns: [
      'dist/**',
      'coverage/**',
      'presets/**',
      'node_modules/**',
      '**/node_modules/**',
      '.pnpm/**',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
  },
})
