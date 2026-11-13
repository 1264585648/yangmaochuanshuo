import { test, expect } from './fixtures.js';

/** Fictional offers seeded by scripts/seed-local.mjs. */
const SEEDED = { all: 13, cloud: 4 };

const cards = (page) => page.locator('.catalog-card');

async function search(page, text) {
  await page.locator('#catalogSearch').fill(text);
  await page.locator('#catalogSearch').press('Enter');
}

test.describe('catalog page', () => {
  test('is reachable from the lobby and lists every live offer', async ({ page }) => {
    await page.goto('/');
    await page.locator('#discoverLink').click();
    await expect(page).toHaveURL(/\/offers$/);
    await expect(page.locator('#catalogTitle')).toHaveText('发现数字福利');
    await expect(cards(page)).toHaveCount(SEEDED.all);
    // Every card names when it was last checked.
    await expect(page.locator('.catalog-card .catalog-verified')).toHaveCount(SEEDED.all);
  });

  test('filters by pool in the URL and restores it with back and forward', async ({ page }) => {
    await page.goto('/offers');
    await page.locator('label.pool-radio', { hasText: '云服务器' }).click();
    await expect(page).toHaveURL(/[?&]pool=cloud/);
    await expect(cards(page)).toHaveCount(SEEDED.cloud);

    await page.goBack();
    await expect(page).toHaveURL(/\/offers$/);
    await expect(cards(page)).toHaveCount(SEEDED.all);
    await page.goForward();
    await expect(page).toHaveURL(/[?&]pool=cloud/);
    await expect(cards(page)).toHaveCount(SEEDED.cloud);
  });

  test('searches by keyword and keeps the query on reload', async ({ page }) => {
    await page.goto('/offers');
    await search(page, 'GPU');
    await expect(page).toHaveURL(/[?&]q=GPU/);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText('GPU');

    await page.reload();
    await expect(page.locator('#catalogSearch')).toHaveValue('GPU');
    await expect(cards(page)).toHaveCount(1);
  });

  test('opens a single offer on its own page', async ({ page }) => {
    await page.goto('/offers?pool=cloud');
    const link = cards(page).first().locator('a[href^="/offers/"]').first();
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator('h1')).toContainText('【示例】');
  });

  test.describe('unknown offer', () => {
    test.use({ expectedErrors: [/status of 404/] });

    test('answers with a noindex 404', async ({ page }) => {
      const res = await page.goto('/offers/no-such-offer');
      expect(res?.status()).toBe(404);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    });
  });
});

test.describe('catalog without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('still filters through the plain form', async ({ page }) => {
    await page.goto('/offers');
    await expect(cards(page)).toHaveCount(SEEDED.all);
    await search(page, 'GPU');
    await expect(page).toHaveURL(/[?&]q=GPU/);
    await expect(cards(page)).toHaveCount(1);
  });
});
