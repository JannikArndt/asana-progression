import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

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
  await expect(page.getByRole('heading', { name: 'Asanas' })).toBeVisible();

  await importVideo(page);

  // Processing, then the session review screen with three candidates.
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  await expect(page.locator('.timeline canvas').first()).toBeVisible();

  // One tap confirms the suggested label (template order).
  const first = cards(page).nth(0);
  await expect(first.getByRole('button', { name: 'Padangusthasana', exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Confirm Padangusthasana' }).click();
  await expect(first).toHaveAttribute('data-status', 'labeled');

  // The next card now suggests the next entry; pick a different one via search instead.
  const second = cards(page).nth(1);
  await expect(second.getByRole('button', { name: 'Padahastasana', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Padahastasana', exact: true }).click();
  await page.getByPlaceholder('Search asanas').fill('utt trik');
  await page.getByRole('button', { name: 'Utthita Trikonasana right' }).click();
  await expect(second).toHaveAttribute('data-status', 'labeled');
  await expect(second.getByText('Utthita Trikonasana R')).toBeVisible();

  // The third card follows the template after Trikonasana R → Trikonasana L. Dismiss it, then restore.
  const third = cards(page).nth(2);
  await expect(third.getByRole('button', { name: 'Utthita Trikonasana L', exact: true })).toBeVisible();
  await third.getByRole('button', { name: /More actions/ }).click();
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

  // Sessions list and the asana page.
  await page.getByRole('button', { name: '‹ Sessions' }).click();
  await expect(page.getByText(/2 labeled · 1 open/)).toBeVisible();
  await page.getByRole('tab', { name: 'Asanas' }).click();
  const row = page.getByRole('button', { name: /Utthita Trikonasana\s+1 hold/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Utthita Trikonasana' })).toBeVisible();
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
