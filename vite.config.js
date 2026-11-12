import { defineConfig } from 'vite';

const DEV_PORT = 4173;
/** `npm run dev:api` serves the Worker (API + built assets) here. */
const API_TARGET = process.env.DEALDEX_API ?? 'http://127.0.0.1:8787';
const CORE_COVERAGE = { lines: 80, functions: 80, branches: 80, statements: 80 };

/** `/offers` and `/offers/<id>` share one page template (`offers.html`). */
const CATALOG_ROUTE = /^\/offers(?:\/[a-z0-9-]*)?\/?(?=\?|$)/;

/**
 * Serve the catalog template for its clean URLs in `vite` and `vite preview`.
 * In production the Worker renders these routes (see worker/src/routes/pages.ts).
 * @returns {import('vite').Plugin}
 */
function catalogRoutes() {
  /** @param {import('vite').Connect.Server} middlewares */
  const install = (middlewares) => {
    middlewares.use((req, _res, next) => {
      const url = req.url ?? '';
      if (CATALOG_ROUTE.test(url)) req.url = url.replace(CATALOG_ROUTE, '/offers.html');
      next();
    });
  };
  return {
    name: 'dealdex-catalog-routes',
    // Pre-middleware: must not return anything (a returned function is a post hook).
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [catalogRoutes()],
  server: { port: DEV_PORT, strictPort: true, proxy: { '/api': API_TARGET } },
  preview: { port: DEV_PORT, strictPort: true, proxy: { '/api': API_TARGET } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html', offers: 'offers.html' } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'worker/src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/api/**': CORE_COVERAGE,
        'src/app/**': CORE_COVERAGE,
        'src/domain/**': CORE_COVERAGE,
        'src/storage/**': CORE_COVERAGE,
        'src/ui/escape.js': CORE_COVERAGE,
        'worker/src/**': CORE_COVERAGE,
      },
    },
  },
});
