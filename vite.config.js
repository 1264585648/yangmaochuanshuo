import { defineConfig } from 'vite';

const DEV_PORT = 4173;

export default defineConfig({
  server: { port: DEV_PORT, strictPort: true },
  preview: { port: DEV_PORT, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['app.js', 'src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
