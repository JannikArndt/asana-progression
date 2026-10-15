import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const video = fileURLToPath(new URL('../fixtures/synthetic-practice-vp9.mp4', import.meta.url));
const otherVideo = fileURLToPath(new URL('../fixtures/h264-bframes.mp4', import.meta.url));

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

  // The third card follows the template after Trikonasana R → Trikonasana L. "Not a pose" hides it
  // in the gap row after the second card; the gap row brings it back.
  const third = cards(page).nth(2);
  await expect(third.getByRole('button', { name: 'Utthita Trikonasana L', exact: true })).toBeVisible();
  await third.getByRole('button', { name: /More actions/ }).click();
  // The menu previews the frames of the hold.
  const frames = page.getByRole('list', { name: 'Frames of this hold' }).getByRole('listitem');
  expect(await frames.count()).toBeGreaterThanOrEqual(4);
  await expect(frames.first().locator('.tiny')).not.toHaveClass(/missing/);
  await page.getByRole('button', { name: 'Not a pose' }).click();
  await expect(cards(page)).toHaveCount(2);
  const skippedGap = page.getByRole('button', { name: /not covered at 00:3\d, 1 skipped: find or add holds/ });
  await expect(skippedGap).toContainText('1 skipped');
  // Analysing the stretch again does not bring back what was marked "Not a pose".
  await skippedGap.click();
  await page.getByRole('button', { name: /^Find holds here/ }).click();
  await expect(page.getByRole('heading', { name: 'No hold found' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await skippedGap.click();
  await page.getByRole('button', { name: /^Show the skipped hold/ }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(third).toHaveAttribute('data-status', 'open');
  await expect(skippedGap).toHaveCount(0);

  // A tap on a thumbnail selects the hold and offers frame actions.
  await first.getByRole('button', { name: 'Frame actions for hold 1' }).click();
  const menu = page.getByRole('menu', { name: 'Hold 1' });
  await expect(menu.getByRole('menuitem', { name: 'Choose frame…' })).toBeVisible();
  await expect(first).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Choose another best frame from the stored samples.
  await third.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('button', { name: 'Choose frame…' }).click();
  await page.getByRole('button', { name: '−1 s' }).click();
  await page.getByRole('button', { name: 'Use this frame' }).click();

  // The graph's chevron shows whether the graph is expanded (rotated) or collapsed.
  const chev = page.getByRole('button', { name: 'Timeline graph' });
  const rotation = () => chev.locator('.chev').evaluate((el) => getComputedStyle(el).transform);
  await expect(chev).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(rotation).toBe('matrix(0, 1, -1, 0, 0, 0)');
  await chev.click();
  await expect(page.locator('.graph canvas')).toHaveCount(0);
  await expect.poll(rotation).toBe('none');
  await chev.click();

  // The video files have their own page; re-running detection there keeps the labels.
  await page.getByRole('link', { name: '1 video ›' }).click();
  await expect(page.getByRole('heading', { name: 'Videos' })).toBeVisible();
  await expect(page.locator('li[data-video-id]')).toHaveCount(1);
  await page.getByRole('button', { name: /^Debug/ }).click();
  await page.getByRole('button', { name: 'Re-run detection' }).click();
  await expect(page.getByText('Detection updated.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '‹ Session' }).click();
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
  await expect(page.getByText(/2 labeled · 2 open · Primary series/)).toBeVisible();
  // The session row shows a captured still (the whole frame) as its thumbnail.
  await expect(page.locator('.row.session .thumb img')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Asanas' }).click();
  const row = page.getByRole('button', { name: /Utthita Trikonasana\s+1 hold/ });
  await expect(row).toBeVisible();
  // The row previews the captured colour still, not the gray analysis frame.
  await expect(row.locator('.thumb img')).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.getByRole('heading', { name: 'Utthita Trikonasana' })).toBeVisible();
  // Progression: the captured still in the feed, the viewer, grid and side filter.
  await expect(page.locator('.feed .item')).toHaveCount(1);
  await expect(page.locator('.feed .item img')).toBeVisible({ timeout: 60_000 });
  await page.locator('.feed .item').click();
  const viewer = page.getByRole('dialog', { name: 'Utthita Trikonasana holds' });
  await expect(viewer.locator('img')).toBeVisible();
  // A tap on the image shows the action bar (nothing opens directly).
  const bar = viewer.getByRole('toolbar', { name: 'Hold actions' });
  await expect(bar).toBeHidden();
  await viewer.locator('.slide.current .media').click();
  await expect(bar).toBeVisible();
  /** The bar hides itself after a few seconds: tap the image again if needed. */
  const action = async (name: string) => {
    if (!(await bar.isVisible())) await viewer.locator('.slide.current .media').click();
    await bar.getByRole('button', { name, exact: true }).click();
  };
  // Choose frame opens the frame picker above the viewer; the page has no video file since the reload.
  await action('Choose frame');
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: '+1 s' }).click();
  await page.getByRole('button', { name: 'Use this frame' }).click();
  await expect(viewer.getByText(/Select synthetic-practice-vp9\.mp4 to save the still/)).toBeVisible();
  await viewer.locator('input[type=file]').setInputFiles(video);
  await expect(viewer.getByText(/to save the still|Saving the still/)).toBeHidden({ timeout: 60_000 });
  // Compare, pose (no model in this test) and the crop editor with portrait presets.
  await action('Compare');
  await expect(bar.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-pressed', 'true');
  await expect(viewer.getByText('Compare needs a second hold of this asana.')).toBeVisible();
  await viewer.getByRole('button', { name: 'Stop', exact: true }).click();
  await action('Pose');
  await expect(viewer.getByRole('status')).toHaveText('Pose model off');
  await action('Edit crop');
  const editor = page.getByRole('dialog', { name: /^Crop/ });
  await editor.getByRole('radio', { name: '2:3' }).click();
  await expect(editor.getByRole('radio', { name: '2:3' })).toHaveAttribute('aria-checked', 'true');
  const mask = editor.locator('.mask');
  const maskAspect = async () => {
    const b = (await mask.boundingBox())!;
    return Math.round((b.width / b.height) * 100) / 100;
  };
  await expect.poll(maskAspect).toBe(0.67);
  // Free: the frame's handles change its shape.
  await editor.getByRole('radio', { name: 'Free' }).click();
  const handle = (await editor.locator('[data-handle=s]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(maskAspect).toBeGreaterThan(0.8);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  // A tap beside the image closes the viewer; so do a pull down and Escape.
  await viewer.locator('.stage').click({ position: { x: 4, y: 4 } });
  await expect(viewer).toBeHidden();
  await page.locator('.feed .item').click();
  const center = (await viewer.locator('.slide.current .media').boundingBox())!;
  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
  await page.mouse.down();
  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2 + 260, { steps: 8 });
  await page.mouse.up();
  await expect(viewer).toBeHidden();
  await page.locator('.feed .item').click();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await page.getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('.tile')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Left' }).click();
  await expect(page.locator('.tile')).toHaveCount(0);

  // Re-importing the same file asks what to do.
  await page.getByRole('button', { name: '‹ Asanas' }).click();
  await page.locator('input[type=file]').first().setInputFiles(video);
  await expect(page.getByText('This video was imported before')).toBeVisible();
  // "Cancel" of a question is the sheet's ✕ in the header.
  await page.getByRole('dialog').locator('header').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  expect(errors).toEqual([]);
});

test('re-selecting files: one picker, files matched by content, the date for the Photos search', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  // Exact frames from the app's own decoder: the fallback when Mediabunny rejects a codec string.
  await page.evaluate(() => localStorage.setItem('asana.debug.capture', JSON.stringify({ cropper: 'none', decoder: 'own' })));
  await importVideo(page);
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  const first = cards(page).nth(0);
  await first.getByRole('button', { name: 'Confirm Adho Mukha Svanasana' }).click();
  await expect(first.locator('[data-capture=done]')).toHaveCount(1, { timeout: 60_000 });

  // After a reload the file is gone: a new label asks for it, with the date to search Photos for.
  await page.reload();
  const second = cards(page).nth(1);
  await second.getByRole('button', { name: /^Confirm / }).click();
  const notice = page.locator('.notice', { hasText: 'again to save full-resolution stills' });
  await expect(notice).toBeVisible();
  // The fixture carries only a file date, not a recording date: no date to search Photos for
  // until the recording time is set by hand.
  await expect(notice.getByText(/^Recording date unknown/)).toBeVisible();
  await expect(notice.getByText('Search Photos for')).toHaveCount(0);
  await notice.getByRole('button', { name: 'Set date…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Recording time' });
  await sheet.locator('input[type=datetime-local]').fill('2025-08-28T07:04');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(notice.getByText('Search Photos for')).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Copy August 28, 2025' })).toBeVisible();
  await expect(notice.locator('[data-needed-video]')).toHaveCount(1);
  await expect(second.locator('[data-capture=needs-file]')).toHaveCount(1);

  // Several files at once, in any order: the right one is attached, the other one named.
  await notice.locator('input[type=file]').setInputFiles([otherVideo, video]);
  await expect(page.getByText('Selected synthetic-practice-vp9.mp4. h264-bframes.mp4 is not one of the imported videos.')).toBeVisible();
  await expect(page.locator('[data-needed-video]')).toHaveCount(0);
  await expect(second.locator('[data-capture=done]')).toHaveCount(1, { timeout: 60_000 });
  await expect(second.locator('.thumb img, img').first()).toBeVisible();

  // The videos page knows the file is selected now.
  await page.getByRole('link', { name: '1 video ›' }).click();
  await expect(page.getByText('File not selected')).toHaveCount(0);
  await expect(page.locator('[data-needed-video]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the videos of a session form one timeline; the files have their own page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('asana.debug.capture', JSON.stringify({ cropper: 'none' })));
  await importVideo(page, 'None');
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });

  // The same file again as a second session of the day, then combined: one session, two videos.
  await page.getByRole('button', { name: '‹ Sessions' }).click();
  await page.locator('input[type=file]').first().setInputFiles(video);
  await page.getByRole('button', { name: /^Import as a new session/ }).click();
  await expect(page.getByText('Suggestions for this session')).toBeVisible();
  await page.getByRole('button', { name: /^None/ }).click();
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  await page.getByRole('button', { name: 'Combine into this session…' }).click();
  await page.getByRole('dialog', { name: 'Combine sessions?' }).getByRole('button', { name: 'Combine', exact: true }).click();

  // One timeline: one sticky head, cards numbered through, the second video's cards in session time.
  await expect(cards(page)).toHaveCount(6);
  await expect(page.locator('.timeline-head')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^More actions for hold 6$/ })).toBeVisible();
  await expect(cards(page).nth(0)).toContainText(/00:\d\d–00:\d\d/);
  await expect(cards(page).nth(3)).toContainText(/01:\d\d–01:\d\d/);

  // The end of the first video and the start of the second are one uncovered stretch: one row.
  const gaps = page.getByRole('button', { name: /not covered at .*: find or add holds/ });
  await expect(gaps).toHaveCount(2);
  const boundary = page.getByRole('button', { name: /not covered at 00:5\d: find or add holds/ });
  await expect(boundary).toHaveCount(1);
  await boundary.click();
  const frames = page.getByRole('list', { name: 'Frames of this hold' }).getByRole('listitem');
  await expect(frames.first()).toContainText(/00:5\d/);
  await expect(frames.last()).toContainText(/01:0\d/);
  await page.getByRole('button', { name: /^Add a hold by hand/ }).click();
  // Adding by hand asks which video's part.
  await expect(page.getByText('This stretch spans several videos. Which part is it in?')).toBeVisible();
  await page.getByRole('button', { name: /^01:00–01:0\d/ }).click();
  await expect(page.getByRole('heading', { name: /^Add hold · 01:00–01:0\d$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(cards(page)).toHaveCount(6);

  // The videos page: both files with their place on the timeline; the order can be changed.
  await page.getByRole('link', { name: '2 videos ›' }).click();
  const items = page.locator('li[data-video-id]');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('00:00–01:00');
  await expect(items.nth(1)).toContainText('01:00–02:00');
  const firstId = await items.nth(0).getAttribute('data-video-id');
  await expect(page.getByRole('button', { name: /^Move .* up$/ }).first()).toBeDisabled();
  await page.getByRole('button', { name: /^Move .* down$/ }).first().click();
  await expect(items.nth(1)).toHaveAttribute('data-video-id', firstId!);
  await expect(page.getByRole('button', { name: /^Debug · / })).toHaveCount(2);
  await page.getByRole('button', { name: '‹ Session' }).click();
  await expect(cards(page)).toHaveCount(6);

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
  await page.getByRole('link', { name: '1 video ›' }).click();
  await page.getByRole('button', { name: /^Debug/ }).click();
  await expect(page.locator('dd', { hasText: /^1×$/ })).toBeVisible();
});

test('a pinned luma-plane conversion is used and finds the three holds', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('asana.debug.pipeline', JSON.stringify({ grayMethod: 'luma' })));
  await importVideo(page, 'None');
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });

  // The last ~10 s are covered by no candidate: a row after the last card finds or adds holds there.
  const gap = page.getByRole('button', { name: /not covered at 00:5\d: find or add holds/ });
  await expect(gap).toHaveCount(1);
  await gap.click();
  // The stretch is analysed on its own: the final 5 s pose is too short for a hold.
  await page.getByRole('button', { name: /^Find holds here/ }).click();
  await expect(page.getByRole('heading', { name: 'No hold found' })).toBeVisible();
  await page.getByRole('button', { name: /^Add a hold by hand/ }).click();
  await expect(page.getByRole('heading', { name: /^Add hold · 00:5\d–01:00$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add hold here' }).click();
  await expect(cards(page)).toHaveCount(4);
  await expect(gap).toHaveCount(0);
  // The new hold stays inside the gap (after the third card's end).
  await expect(cards(page).nth(3)).toContainText(/00:5\d–(00:5\d|01:00)/);

  await page.getByRole('link', { name: '1 video ›' }).click();
  // The videos page shows where the video sits on the session timeline.
  await expect(page.locator('li[data-video-id]')).toContainText(/00:00–01:00/);
  await page.getByRole('button', { name: /^Debug/ }).click();
  // Pinned runs skip the benchmark, so the row ends with the method (and pixel format).
  await expect(page.locator('dt:has-text("Frame → gray") + dd')).toHaveText(/· luma( \([^)]*\))?$/);
  // The synthetic video carries no location.
  await expect(page.locator('dt:has-text("Location") + dd')).toHaveText('–');
  await page.getByRole('button', { name: '‹ Session' }).click();

  // Header: the template picker lists every template; the place is named in a sheet.
  await page.getByRole('button', { name: 'Template: No template' }).click();
  await page.getByRole('dialog', { name: 'Suggestions' }).getByRole('button', { name: /^Primary series/ }).click();
  await expect(page.getByRole('button', { name: 'Template: Primary series' })).toBeVisible();
  await page.getByRole('button', { name: 'Add location' }).click();
  const sheet = page.getByRole('dialog', { name: 'Location' });
  await expect(sheet.getByText(/carry no location/)).toBeVisible();
  await sheet.getByLabel('Place name').fill('Shala');
  await sheet.locator('header').getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Location: Shala. Edit' })).toBeVisible();

  // The sessions list: thumbnail (tiny analysis frame, nothing captured), template and place.
  await page.getByRole('button', { name: '‹ Sessions' }).click();
  const row = page.locator('.row.session').first();
  await expect(row).toContainText(/0 labeled · 4 open · Primary series/);
  await expect(row).toContainText('Shala');
  await expect(row.locator('.thumb .tiny')).not.toHaveClass(/missing/);
});

test('lettered variants: one row with letters, separate progressions per letter', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('asana.debug.capture', JSON.stringify({ cropper: 'none' })));
  await importVideo(page);
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  const first = cards(page).nth(0);
  await first.getByRole('button', { name: 'Adho Mukha Svanasana', exact: true }).click();
  await page.getByPlaceholder('Search asanas').fill('sp');
  // The family reads as one asana with letters; each letter has R/L like a sided asana.
  const picker = page.getByRole('dialog', { name: 'Label' });
  await expect(picker.getByText('Supta Padangusthasana', { exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Supta Padangusthasana A right' })).toBeVisible();
  await picker.getByRole('button', { name: 'Supta Padangusthasana B right' }).click();
  await expect(first.getByText('Supta Padangusthasana B R')).toBeVisible();

  await page.getByRole('button', { name: '‹ Sessions' }).click();
  await page.getByRole('tab', { name: 'Asanas' }).click();
  await page.getByRole('button', { name: /Supta Padangusthasana\s+1 hold\s+·\s+A\s*B/ }).click();
  // The letter with the newest hold opens; the other letter is its own (empty) progression.
  await expect(page).toHaveURL(/#\/asana\/supta-padangusthasana-b$/);
  await expect(page.getByRole('heading', { name: 'Supta Padangusthasana' })).toBeVisible();
  const variant = page.getByRole('radiogroup', { name: 'Variant' });
  await expect(variant.getByRole('radio', { name: 'Supta Padangusthasana B' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.feed .item')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Right' }).click();
  await variant.getByRole('radio', { name: 'Supta Padangusthasana A' }).click();
  await expect(page).toHaveURL(/#\/asana\/supta-padangusthasana$/);
  await expect(page.getByText('No holds labeled yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Right' })).toHaveAttribute('aria-checked', 'true');
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
  // The pose overlay runs the model on the stored still (the synthetic figure is no person).
  await page.goto('./#/asana/adho-mukha-svanasana');
  await page.locator('.feed .item').click();
  const viewer = page.getByRole('dialog', { name: 'Adho Mukha Svanasana holds' });
  await viewer.locator('.slide.current .media').click();
  await viewer.getByRole('toolbar', { name: 'Hold actions' }).getByRole('button', { name: 'Pose', exact: true }).click();
  await expect(viewer.getByRole('status')).toHaveText(/^(No pose found|Pose · .+)$/, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('sheets: close in the header, backdrop tap and swipe down dismiss', async ({ page }) => {
  await page.goto('./#/catalog');
  // An editor: Cancel top-left, Save top-right.
  await page.getByRole('button', { name: 'Add asana' }).click();
  const edit = page.getByRole('dialog', { name: 'Add asana' });
  const header = edit.locator('header');
  await expect(header.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.waitForTimeout(400); // opening animation
  await expect(header.getByRole('button', { name: 'Save' })).toBeVisible();
  const cancelBox = (await header.getByRole('button', { name: 'Cancel' }).boundingBox())!;
  const saveBox = (await header.getByRole('button', { name: 'Save' }).boundingBox())!;
  const bodyBox = (await edit.locator('.body').boundingBox())!;
  expect(cancelBox.x).toBeLessThan(saveBox.x);
  expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(bodyBox.y + 1);
  await expect(edit.getByRole('button', { name: /Cancel|Close/ })).toHaveCount(1);
  await page.touchscreen.tap(195, 40);
  await expect(edit).toBeHidden();

  await page.getByRole('button', { name: 'Add asana' }).click();
  await expect(edit).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // Dragging the grabber: a short pull snaps back, a long one dismisses.
  const drag = async (dy: number) => {
    const g = (await edit.locator('.grabber').boundingBox())!;
    const x = g.x + g.width / 2;
    const y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + (dy * i) / 10);
    await page.mouse.up();
  };
  await page.getByRole('button', { name: 'Add asana' }).click();
  await expect(edit).toBeVisible();
  await page.waitForTimeout(400);
  await drag(30);
  await page.waitForTimeout(400);
  await expect(edit).toBeVisible();
  await drag(400);
  await expect(edit).toBeHidden();
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
  const sheet = page.getByRole('dialog', { name: 'Add asanas' });
  await sheet.locator('header').getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
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

test('research export and detection lab on a fully labeled video', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('worker', (w) => w.on('console', (m) => m.text().includes('pose model unavailable') && errors.push(m.text())));
  // With the MediaPipe model: the research worker loads it too (cached by the capture worker).
  await page.goto('./');
  await importVideo(page);
  await expect(cards(page)).toHaveCount(3, { timeout: 90_000 });
  // Fully labeled: two confirmed, one "Not a pose".
  for (const i of [0, 1]) {
    await cards(page).nth(i).getByRole('button', { name: /^Confirm / }).click();
    await expect(cards(page).nth(i)).toHaveAttribute('data-status', 'labeled');
  }
  await cards(page).nth(2).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('button', { name: 'Not a pose' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('[data-capture=done]')).toHaveCount(2, { timeout: 60_000 });

  await page.goto('./#/settings');
  const diag = page.getByRole('region', { name: 'Diagnostics' });
  await diag.getByRole('button', { name: 'Export research data' }).click();
  await expect(diag.getByText(/Research data ready: asana-progression-research-\d{4}-\d\d-\d\d\.json/)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), diag.getByRole('button', { name: 'Save', exact: true }).click()]);
  const text = readFileSync(await download.path(), 'utf8');
  expect(text).not.toContain('synthetic-practice');
  const x = JSON.parse(text);
  expect(x).toMatchObject({ format: 'asana-progression/research', version: 1, cropper: 'mediapipe-pose' });
  expect(x.sessions).toHaveLength(1);
  expect(x.sessions[0].fullyLabeled).toBe(true);
  expect(x.analyses[0].fresh.candidates.length).toBeGreaterThan(0);
  expect(x.analyses[0].signals.from).toBe('stored');
  expect(x.holds).toHaveLength(2);
  // The synthetic figure is no person: usually no body, but the model may still find one.
  for (const h of x.holds) expect(['no-body', 'ok']).toContain(h.poseStatus);
  expect(x.summary.fullyLabeled.holds).toBe(2);

  await diag.getByRole('button', { name: 'Detection lab ›' }).click();
  await expect(page.getByRole('heading', { name: 'Detection lab' })).toBeVisible();
  await expect(page.getByText('1 fully labeled video in 1 session.')).toBeVisible();
  await expect(page.getByText('144 parameter sets')).toBeVisible();
  const grid = page.getByLabel(/Parameter grid/);
  await grid.fill('{"vary": {"stillPercentile": [50, 55], "pool": [1]}}');
  await expect(page.getByText(/"pool" shapes the stored frames/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  await grid.fill('{"vary": {"stillPercentile": [50, 55]}}');
  await expect(page.getByText('2 parameter sets')).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('heading', { name: 'Best 2 of 2' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('current defaults')).toBeVisible();
  await page.getByRole('button', { name: 'Export results' }).click();
  const [labDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save', exact: true }).click()]);
  const report = JSON.parse(readFileSync(await labDownload.path(), 'utf8'));
  expect(report).toMatchObject({ format: 'asana-progression/lab', sessions: [x.sessions[0].id] });
  expect(report.combos).toHaveLength(2);
  expect(report.reference.total.holds).toBe(2);
  // The grid text is kept for the next visit.
  await page.reload();
  await expect(page.getByText('2 parameter sets')).toBeVisible();
  expect(errors).toEqual([]);
});
