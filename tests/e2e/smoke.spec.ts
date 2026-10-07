import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const video = fileURLToPath(new URL('../fixtures/synthetic-practice-vp9.mp4', import.meta.url));

test('import → processing → holds on the timeline', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Asanas' })).toBeVisible();

  await page.locator('input[type=file]').first().setInputFiles(video);

  // Processing screen with the live graph, then the analysis screen.
  await expect(page.getByText('synthetic-practice-vp9.mp4').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'synthetic-practice-vp9.mp4' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/3 holds/)).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('article.cand')).toHaveCount(3);
  await expect(page.locator('.timeline canvas')).toBeVisible();

  // Tap a hold on the list → it is selected.
  await page.locator('article.cand').nth(1).locator('button.thumb').click();
  await expect(page.locator('article.cand.selected')).toHaveCount(1);

  // Debug panel: re-run detection from the stored samples.
  await page.getByRole('button', { name: /Debug/ }).click();
  await page.getByRole('button', { name: 'Re-run detection' }).click();
  await expect(page.getByText('Detection updated.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('article.cand')).toHaveCount(3);

  // Back home: the video is listed with its hold count.
  await page.getByRole('button', { name: '‹ Videos' }).click();
  await expect(page.getByText('3 holds')).toBeVisible();

  // Re-importing the same file asks what to do.
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
  await page.locator('input[type=file]').first().setInputFiles(video);
  // Wait for the first checkpoint (written every 5 s of processing).
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
  await expect(page.getByText(/3 holds/)).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: /Debug/ }).click();
  await expect(page.locator('dd', { hasText: /^1×$/ })).toBeVisible();
});
