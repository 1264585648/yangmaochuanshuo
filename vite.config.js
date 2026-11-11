import { defineConfig } from 'vite';

const DEV_PORT = 4173;
const CORE_COVERAGE = { lines: 80, functions: 80, branches: 80, statements: 80 };

export default defineConfig({
  server: { port: DEV_PORT, strictPort: true },
  preview: { port: DEV_PORT, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/domain/**': CORE_COVERAGE,
        'src/storage/**': CORE_COVERAGE,
        'src/ui/escape.js': CORE_COVERAGE,
      },
    },
  },
});
