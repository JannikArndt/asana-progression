import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const video = fileURLToPath(new URL('../fixtures/synthetic-practice-vp9.mp4', import.meta.url));

async function importVideo(page: Page, template: 'Primary series' | 'None' = 'Primary series') {
  await page.locator('input[type=file]').first().setInputFiles(video);
  await expect(page.getByText('Suggestions for this session')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${template}`) }).click();
}

const cards = (page: Page) => page.locator('article.review');

test('import → review → asana', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  // The pose model is not needed here: capture without the MediaPipe cropper.
  await page.evaluate(() => localStorage.setItem('asana.debug.capture', JSON.stringify({ cropper: 'none' })));
  await expect(page.getByRole('heading', { name: 'Asanas' })).toBeVisible();

  await importVideo(page);

  // Processing, then the session review screen with three candidates.
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  await expect(page.locator('.timeline canvas').first()).toBeVisible();

  // One tap confirms the suggested label (template order: the series starts with the sun salutations).
  const first = cards(page).nth(0);
  await expect(first.getByRole('button', { name: 'Adho Mukha Svanasana', exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Confirm Adho Mukha Svanasana' }).click();
  await expect(first).toHaveAttribute('data-status', 'labeled');

  // The next card now suggests the next entry; pick a different one via search instead.
  const second = cards(page).nth(1);
  await expect(second.getByRole('button', { name: 'Adho Mukha Svanasana', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Adho Mukha Svanasana', exact: true }).click();
  await page.getByPlaceholder('Search asanas').fill('utt trik');
  await page.getByRole('button', { name: 'Utthita Trikonasana right' }).click();
  await expect(second).toHaveAttribute('data-status', 'labeled');
  await expect(second.getByText('Utthita Trikonasana R')).toBeVisible();

  // The third card follows the template after Trikonasana R → Trikonasana L. Dismiss it, then restore.
  const third = cards(page).nth(2);
  await expect(third.getByRole('button', { name: 'Utthita Trikonasana L', exact: true })).toBeVisible();
  await third.getByRole('button', { name: /More actions/ }).click();
  // The menu previews the frames of the hold.
  const frames = page.getByRole('list', { name: 'Frames of this hold' }).getByRole('listitem');
  expect(await frames.count()).toBeGreaterThanOrEqual(4);
  await expect(frames.first().locator('.tiny')).not.toHaveClass(/missing/);
  await page.getByRole('button', { name: 'Not a pose' }).click();
  await expect(third).toHaveAttribute('data-status', 'dismissed');
  await third.getByRole('button', { name: 'Restore' }).click();
  await expect(third).toHaveAttribute('data-status', 'open');

  // Choose another best frame from the stored samples.
  await third.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('button', { name: 'Choose frame…' }).click();
  await page.getByRole('button', { name: '−1 s' }).click();
  await page.getByRole('button', { name: 'Use this frame' }).click();

  // Re-running detection keeps the labels.
  await page.getByRole('button', { name: /^Debug/ }).click();
  await page.getByRole('button', { name: 'Re-run detection' }).click();
  await expect(page.getByText('Detection updated.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('article.review[data-status=labeled]')).toHaveCount(2);

  // Labels survive a reload (persisted immediately).
  await page.reload();
  await expect(page.locator('article.review[data-status=labeled]')).toHaveCount(2);

  // Split the open hold into two at its clearest posture change.
  await cards(page).nth(2).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('button', { name: 'Split into several…' }).click();
  await page.getByRole('button', { name: '2 holds' }).click();
  await expect(cards(page)).toHaveCount(4);

  // Sessions list and the asana page.
  await page.getByRole('button', { name: '‹ Sessions' }).click();
  await expect(page.getByText(/2 labeled · 2 open/)).toBeVisible();
  await page.getByRole('tab', { name: 'Asanas' }).click();
  const row = page.getByRole('button', { name: /Utthita Trikonasana\s+1 hold/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Utthita Trikonasana' })).toBeVisible();
  // Progression: the captured still in the feed, the viewer, grid and side filter.
  await expect(page.locator('.feed .item')).toHaveCount(1);
  await expect(page.locator('.feed .item img')).toBeVisible({ timeout: 60_000 });
  await page.locator('.feed .item').click();
  const viewer = page.getByRole('dialog', { name: 'Utthita Trikonasana holds' });
  await expect(viewer.locator('img')).toBeVisible();
  await viewer.getByRole('button', { name: 'Pin' }).click();
  await expect(viewer.getByRole('button', { name: 'Pinned' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('.tile')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Left' }).click();
  await expect(page.locator('.tile')).toHaveCount(0);

  // Re-importing the same file asks what to do.
  await page.getByRole('button', { name: '‹ Asanas' }).click();
  await page.locator('input[type=file]').first().setInputFiles(video);
  await expect(page.getByText('This video was imported before')).toBeVisible();
  await page.getByRole('button', { name: /Cancel/ }).click();

  expect(errors).toEqual([]);
});

test('version.json is served and the manifest is linked', async ({ page, request }) => {
  const res = await request.get('./version.json');
  expect(res.ok()).toBe(true);
  expect((await res.json()).version).toBeTruthy();
  await page.goto('./');
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', './manifest.webmanifest');
  const manifest = await request.get('./manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
});

test('processing resumes after the page was reloaded mid-way', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('asana.debug.pipeline', JSON.stringify({ sampleDelayMs: 40, checkpointMs: 500 })));
  await importVideo(page, 'None');
  // Wait for the first checkpoint (written every 5 s of processing; 0.5 s here).
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('asana-progression');
              req.onsuccess = () => {
                const db = req.result;
                const get = db.transaction('jobs').objectStore('jobs').getAll();
                get.onsuccess = () => {
                  const jobs = get.result as Array<{ nextIndex: number }>;
                  db.close();
                  resolve(jobs[0]?.nextIndex ?? 0);
                };
              };
            }),
        ),
      { timeout: 60_000, intervals: [500] },
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => localStorage.removeItem('asana.debug.pipeline'));
  await page.reload();
  await expect(page.getByText(/stopped at/)).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles(video);
  await expect(page.getByText('Resume processing?')).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  await page.getByRole('button', { name: /^Debug/ }).click();
  await expect(page.locator('dd', { hasText: /^1×$/ })).toBeVisible();
});

test('a pinned luma-plane conversion is used and finds the three holds', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('asana.debug.pipeline', JSON.stringify({ grayMethod: 'luma' })));
  await importVideo(page, 'None');
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  await page.getByRole('button', { name: /^Debug/ }).click();
  // Pinned runs skip the benchmark, so the row ends with the method (and pixel format).
  await expect(page.locator('dt:has-text("Frame → gray") + dd')).toHaveText(/· luma( \([^)]*\))?$/);
});

test('capture works with the MediaPipe cropper (self-hosted wasm and model)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.text().includes('pose model unavailable') && errors.push(m.text()));
  page.on('worker', (w) => w.on('console', (m) => m.text().includes('pose model unavailable') && errors.push(m.text())));
  await page.goto('./');
  await importVideo(page);
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  const first = cards(page).nth(0);
  await first.getByRole('button', { name: 'Confirm Adho Mukha Svanasana' }).click();
  await expect(first.locator('[data-capture=done]')).toHaveCount(1, { timeout: 90_000 });
  const cached = await page.evaluate(async () => (await (await caches.open('mediapipe-pose-v1')).keys()).map((r) => r.url.split('/').pop()));
  expect(cached).toEqual(expect.arrayContaining(['vision_wasm_module_internal.wasm', 'pose_landmarker_lite.task']));
  expect(errors).toEqual([]);
});

test('catalog and template editor', async ({ page }) => {
  await page.goto('./#/catalog');
  await page.getByRole('button', { name: 'Add asana' }).click();
  await page.getByLabel('Name').fill('Parsva Bakasana');
  await page.getByLabel(/both sides/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: /Parsva Bakasana/ })).toBeVisible();

  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Template name').fill('Arm balances');
  await page.getByLabel('Template name').press('Enter');
  await page.getByRole('button', { name: 'Add asanas' }).click();
  await page.getByPlaceholder('Search asanas').fill('pb');
  await page.getByRole('button', { name: /^Parsva Bakasana/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.entries li')).toHaveText([/1\s*Parsva Bakasana R/, /2\s*Parsva Bakasana L/]);
  await page.reload();
  await expect(page.locator('.entries li')).toHaveCount(2);
  await page.getByRole('button', { name: '‹ Catalog' }).click();
  await expect(page.getByRole('button', { name: /Arm balances\s*2 entries/ })).toBeVisible();
});

test('backup export → delete all data → import restores labels, stills and frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('asana.debug.capture', JSON.stringify({ cropper: 'none' })));
  await importVideo(page);
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  const first = cards(page).nth(0);
  await first.getByRole('button', { name: 'Confirm Adho Mukha Svanasana' }).click();
  await expect(first.locator('[data-capture=done]')).toHaveCount(1, { timeout: 60_000 });

  await page.goto('./#/settings');
  const section = page.getByRole('region', { name: 'Backup' });
  await section.getByLabel(/Include analysis frames/).check();
  await section.getByRole('button', { name: 'Create backup' }).click();
  await expect(section.getByText(/Backup ready: asana-progression-\d{4}-\d\d-\d\d\.zip/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: 'Save', exact: true }).click()]);
  const zip = test.info().outputPath('backup.zip');
  await download.saveAs(zip);
  await expect(section.getByText(/^Last backup/).locator('xpath=following-sibling::dd[1]')).not.toHaveText(/none/);

  // Wipe everything, then restore.
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Delete everything' }).click()]);
  await expect(page.getByRole('region', { name: 'Backup' })).toBeVisible();
  // Passed as a buffer: a path in test-results contains "→", which setInputFiles silently drops.
  const backupFile = { name: 'backup.zip', mimeType: 'application/zip', buffer: readFileSync(zip) };
  await page.getByRole('region', { name: 'Backup' }).locator('input[type=file]').setInputFiles(backupFile);
  await expect(page.getByRole('heading', { name: 'Import backup?' })).toBeVisible();
  await expect(page.getByText(/Adds 1 session, 1 labeled hold, 3 images and clips, 1 video, 1 analysis/)).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup imported' })).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload app' }).click()]);

  await page.goto('./');
  await page.getByRole('tab', { name: 'Sessions' }).click();
  await expect(page.getByText(/1 labeled · 2 open/)).toBeVisible();
  await page.getByText(/1 labeled · 2 open/).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0)).toHaveAttribute('data-status', 'labeled');
  // Tiny frames came back with the analysis frames.
  await expect(cards(page).nth(1).locator('.tiny').first()).not.toHaveClass(/missing/);
  await page.goto('./#/asana/adho-mukha-svanasana');
  await expect(page.locator('.feed .item img')).toBeVisible();

  // Importing the same backup again changes nothing.
  await page.goto('./#/settings');
  await page.getByRole('region', { name: 'Backup' }).locator('input[type=file]').setInputFiles(backupFile);
  await expect(page.getByRole('heading', { name: 'Already up to date' })).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  expect(errors).toEqual([]);
});
