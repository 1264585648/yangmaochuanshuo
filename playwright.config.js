import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8790);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker: every guest comes from 127.0.0.1 and shares its per-IP limits.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `https://127.0.0.1:${PORT}`,
    // wrangler dev serves HTTPS with a self-signed certificate.
    ignoreHTTPSErrors: true,
    // Playwright's screenshot preparation injects a <style> into the page, which
    // the site's CSP rightly blocks and the browser-error check would report.
    // Failures are debugged from the trace's DOM snapshots instead.
    trace: { mode: 'retain-on-failure', screenshots: false },
    screenshot: 'off',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `https://127.0.0.1:${PORT}/api/offers`,
    ignoreHTTPSErrors: true,
    env: { E2E_PORT: String(PORT) },
    // A fresh database per run keeps per-IP rate limits from carrying over.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
