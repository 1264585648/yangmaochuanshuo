import { test, expect, openLobby, watchErrors } from './fixtures.js';

const selectedPack = (page) => page.locator('#packScene .pack[aria-pressed="true"]');
const dialog = (page) => page.locator('#overlay');

async function closeDialog(page) {
  await page.locator('#closeDialog').click();
  await expect(dialog(page)).toBeHidden();
}

test.describe('lobby', () => {
  test('lists four pools and switches between them', async ({ page }) => {
    await openLobby(page);
    await expect(page.locator('#packScene .pack')).toHaveCount(4);
    const first = await selectedPack(page).getAttribute('data-pool');
    const description = await page.locator('#selectedDescription').textContent();

    await page.locator('#nextPack').click();
    await expect(selectedPack(page)).not.toHaveAttribute('data-pool', first);
    await expect(page.locator('#selectedDescription')).not.toHaveText(description);

    await page.locator('#prevPack').click();
    await expect(selectedPack(page)).toHaveAttribute('data-pool', first);
  });

  test('publishes the odds of every rarity', async ({ page }) => {
    await openLobby(page);
    await page.locator('#probabilityButton').click();
    await expect(dialog(page)).toBeVisible();
    const rows = page.locator('.odds-table tbody tr');
    await expect(rows).not.toHaveCount(0);
    await expect(rows.first()).toContainText('%');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
  });
});

// One anonymous guest walks the whole flow, so these run in order on one page.
test.describe.serial('a guest opening packs', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  let drawn = '';
  const problems = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    const {
      baseURL,
      ignoreHTTPSErrors,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      locale,
      timezoneId,
    } = testInfo.project.use;
    const context = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      locale,
      timezoneId,
    });
    page = await context.newPage();
    watchErrors(page, problems);
  });

  test.afterEach(() => {
    expect(problems.splice(0), 'browser errors').toEqual([]);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('opens a pack and reveals a card from the server', async () => {
    await openLobby(page);
    await expect(page.locator('#metaRemaining')).toHaveText('3 / 3');
    await page.locator('#openPack').click();

    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#dialogTitle')).toHaveText('发现一张新的福利卡');
    drawn = (await page.locator('.reveal-details .reward-name').textContent())?.trim() ?? '';
    expect(drawn).not.toBe('');
    await expect(page.locator('#metaRemaining')).toHaveText('2 / 3');
    await expect(page.locator('#headerRemaining')).toHaveText('2 / 3');
  });

  test('identifies the guest with an HttpOnly cookie that scripts cannot read', async () => {
    const cookie = (await page.context().cookies()).find((c) => c.name === '__Host-ddx_sid');
    expect(cookie).toMatchObject({ httpOnly: true, path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('ddx_sid');
  });

  test('saves the card as a favourite from the result', async () => {
    const favorite = page.locator('#favoriteResult');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await closeDialog(page);
  });

  test('keeps quota, collection and favourite after a reload', async () => {
    await page.reload();
    await expect(page.locator('#openPack')).toBeEnabled();
    await expect(page.locator('#metaRemaining')).toHaveText('2 / 3');

    await page.locator('[data-nav="collection"]').click();
    await expect(page.locator('#dialogTitle')).toHaveText('我的福利图鉴');
    await expect(page.locator('.dialog-lead')).toContainText('已发现 1 /');
    await expect(page.locator('.dialog-lead')).toContainText('收藏 1 张');
    const item = page.locator('.collection-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(drawn);
    await expect(item.locator('.small-fav')).toBeVisible();
    await expect(page.locator('.history-row')).toHaveCount(1);
  });

  test('opens a collected card and returns to the collection', async () => {
    await page.locator('.collection-item').click();
    await expect(page.locator('.detail-dialog .reward-name')).toHaveText(drawn);
    await expect(page.locator('#favoriteResult')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#dialogBack').click();
    await expect(page.locator('#dialogTitle')).toHaveText('我的福利图鉴');
    await closeDialog(page);
  });

  test('stops at three draws a day', async () => {
    for (const left of ['1 / 3', '0 / 3']) {
      await page.locator('#openPack').click();
      await expect(dialog(page)).toBeVisible();
      await expect(page.locator('#dialogTitle')).toHaveText(/福利卡/);
      await expect(page.locator('#metaRemaining')).toHaveText(left);
      await closeDialog(page);
    }
    await page.reload();
    await expect(page.locator('#metaRemaining')).toHaveText('0 / 3');
    await expect(page.locator('#openPack')).toBeDisabled();
    await expect(page.locator('#openLabel')).toHaveText('明日再来');
  });

  test('refuses a fourth draw on the server even when the page is bypassed', async () => {
    const res = await page.request.post('/api/draws', {
      headers: {
        origin: new URL(page.url()).origin,
        'idempotency-key': `e2e-bypass-${Date.now()}`,
      },
      data: { pool: 'ai' },
    });
    expect(res.status()).toBe(429);
    expect((await res.json()).error.code).toBe('quota_exhausted');
  });
});
