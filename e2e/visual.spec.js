/* Visual regression. Baselines are rendered on Linux (the CI runner, see
 * .github/workflows/visual-baselines.yml), because system fonts and text
 * rasterising differ between operating systems. Elsewhere these tests are
 * skipped unless VISUAL_ANY_OS is set for a local preview.
 *
 * Uses the plain Playwright test: taking a screenshot injects a style element
 * that the site's CSP blocks, which the browser-error fixture would report. */
import { test, expect } from '@playwright/test';

test.skip(
  process.platform !== 'linux' && !process.env.VISUAL_ANY_OS,
  'baselines are rendered on Linux; run in CI or set VISUAL_ANY_OS for a local preview',
);

/** Dates that move with the calendar. Catalog cards show absolute dates. */
const DYNAMIC = ['.catalog-verified', '.catalog-validity', 'time'];

const shot = (page, name, options = {}) =>
  expect(page).toHaveScreenshot(name, {
    fullPage: true,
    // One image pixel per CSS pixel keeps phone and tablet baselines small.
    scale: 'css',
    mask: DYNAMIC.map((selector) => page.locator(selector)),
    ...options,
  });

async function openLobby(page) {
  await page.goto('/');
  await expect(page.locator('#openPack')).toBeEnabled();
  await expect(page.locator('#metaRemaining')).toHaveText('3 / 3');
}

test.describe('visual', () => {
  test('lobby', async ({ page }) => {
    await openLobby(page);
    await shot(page, 'lobby.png', { fullPage: false });
  });

  test('odds dialog', async ({ page }) => {
    await openLobby(page);
    await page.locator('#probabilityButton').click();
    await expect(page.locator('.odds-table')).toBeVisible();
    await shot(page, 'odds.png', { fullPage: false });
  });

  test('empty collection', async ({ page }) => {
    await openLobby(page);
    await page.locator('[data-nav="collection"]').click();
    await expect(page.locator('#dialogTitle')).toHaveText('我的福利图鉴');
    await shot(page, 'collection-empty.png', { fullPage: false });
  });

  test('catalog', async ({ page }) => {
    await page.goto('/offers');
    await expect(page.locator('.catalog-card')).toHaveCount(13);
    await shot(page, 'catalog.png');
  });

  test('catalog with no results', async ({ page }) => {
    await page.goto('/offers?q=zzzz');
    await expect(page.locator('.catalog-card')).toHaveCount(0);
    await shot(page, 'catalog-empty.png');
  });

  test('offer page', async ({ page }) => {
    await page.goto('/offers/demo-cloud-credit');
    await expect(page.locator('h1')).toContainText('云平台开发者赠金');
    await shot(page, 'offer.png');
  });

  test('not found page', async ({ page }) => {
    await page.goto('/offers/no-such-offer');
    await shot(page, 'not-found.png');
  });

  test('admin sign-in', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await shot(page, 'admin-sign-in.png', { fullPage: false });
  });
});
