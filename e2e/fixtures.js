import { test as base, expect } from '@playwright/test';

/**
 * Collect console errors, uncaught exceptions and CSP violations (reported as
 * console errors) into `problems`.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} problems
 */
export function watchErrors(page, problems) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
}

/** Fails a test on any browser error, so script and policy regressions surface even when the flow works. */
export const test = base.extend({
  /** Browser errors a test expects, e.g. the 404 a not-found page logs. */
  expectedErrors: [[], { option: true }],
  page: async ({ page, expectedErrors }, use) => {
    const problems = [];
    watchErrors(page, problems);
    await use(page);
    const unexpected = problems.filter((p) => !expectedErrors.some((re) => re.test(p)));
    expect(unexpected, 'browser errors').toEqual([]);
  },
});

export { expect };

/** Wait until the lobby has loaded pools and quota. */
export async function openLobby(page) {
  await page.goto('/');
  await expect(page.locator('#openPack')).toBeEnabled();
}
