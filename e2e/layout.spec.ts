import { expect, test, type Page } from '@playwright/test';
import { SMOKE_VIDEO_BASE64 } from './fixtures/smoke-video';
import { highlightsResponse, transcribeResponse } from './fixtures/mock-api';

async function setup(page: Page): Promise<void> {
  await page.route('**/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/transcribe', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(transcribeResponse()) }));
  await page.route('**/highlights', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(highlightsResponse()) }));
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'layout.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(SMOKE_VIDEO_BASE64, 'base64'),
  });
  await expect(page.getByRole('heading', { name: /Suggested clips/ })).toBeVisible({ timeout: 90_000 });
}

/** The editor must fill the whole browser window and never scroll the page itself. */
for (const [label, width, height] of [['desktop', 1280, 900], ['laptop', 1366, 768], ['compact', 942, 620]] as const) {
  test(`editor fills the window without scrolling (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await setup(page);

    // All design.md regions are present in the single-window layout.
    await expect(page.getByRole('textbox', { name: 'Project title' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Video preview' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Properties panel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Info' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Export clip 1' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crop', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Export 1 clip$/ })).toBeVisible();

    const layout = await page.evaluate(() => {
      const win = document.querySelector('#root > div > div');
      const rect = win?.getBoundingClientRect();
      window.scrollTo(0, 9999);
      const y = window.scrollY;
      window.scrollTo(9999, 0);
      return {
        width: Math.round(rect?.width ?? 0),
        height: Math.round(rect?.height ?? 0),
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        scrollY: y,
        scrollX: window.scrollX,
      };
    });

    expect(layout.width).toBe(layout.viewportWidth);
    expect(layout.height).toBe(layout.viewportHeight);
    expect(layout.scrollY).toBe(0);
    expect(layout.scrollX).toBe(0);

    // The Timeline must never clip or scroll its own tracks.
    const timeline = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Timeline"]');
      const inner = el?.querySelector('.rounded-2xl');
      if (!el || !inner) return null;
      return {
        sectionScrollH: el.scrollHeight,
        sectionClientH: el.clientHeight,
        sectionScrollW: el.scrollWidth,
        sectionClientW: el.clientWidth,
        innerScrollH: inner.scrollHeight,
        innerClientH: inner.clientHeight,
        innerScrollW: inner.scrollWidth,
        innerClientW: inner.clientWidth,
      };
    });
    expect(timeline).not.toBeNull();
    expect(timeline!.sectionScrollH).toBeLessThanOrEqual(timeline!.sectionClientH + 1);
    expect(timeline!.sectionScrollW).toBeLessThanOrEqual(timeline!.sectionClientW + 1);
    expect(timeline!.innerScrollH).toBeLessThanOrEqual(timeline!.innerClientH + 1);
    expect(timeline!.innerScrollW).toBeLessThanOrEqual(timeline!.innerClientW + 1);

    // Track labels (image / text / audio) must line up with their own lanes.
    const alignment = await page.evaluate(() => {
      const inner = document.querySelector('[aria-label="Timeline"]')?.querySelector('.rounded-2xl');
      const labels = inner?.firstElementChild;
      const area = inner?.lastElementChild;
      const lanes = area?.lastElementChild;
      if (!labels || !area || !lanes) return null;
      const visible = (el: Element): boolean => el.getBoundingClientRect().height > 0;
      const top = (el: Element): number => Math.round(el.getBoundingClientRect().top);
      return {
        labels: [...labels.children].filter(visible).map(top),
        lanes: [...area.children]
          .filter(visible)
          .flatMap((el) =>
            el === lanes
              ? [...el.children]
                  .filter((child) => visible(child) && !child.className.includes('absolute'))
                  .slice(0, 4)
                  .map(top)
              : [top(el)],
          ),
      };
    });
    expect(alignment).not.toBeNull();
    expect(alignment!.labels).toHaveLength(alignment!.lanes.length);
    alignment!.labels.forEach((top, index) => {
      expect(Math.abs(top - alignment!.lanes[index]!)).toBeLessThanOrEqual(1);
    });
  });
}

/** Trim handles and the clip body must be draggable, updating the real clip range. */
test('timeline handles slide to trim and move the clip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);

  const startInput = page.getByRole('spinbutton', { name: 'Clip start' });
  const endInput = page.getByRole('spinbutton', { name: 'Clip end' });
  const startBefore = Number(await startInput.inputValue());
  const endBefore = Number(await endInput.inputValue());

  // Drag the end handle to the right by ~5% of the track width.
  const endHandle = page.getByRole('button', { name: 'Drag clip end' });
  const box = await endHandle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();

  const endAfter = Number(await endInput.inputValue());
  expect(endAfter).toBeGreaterThan(endBefore);
  expect(Number(await startInput.inputValue())).toBe(startBefore);

  // Drag the start handle to the right; the end must stay put.
  const startHandle = page.getByRole('button', { name: 'Drag clip start' });
  const startBox = await startHandle.boundingBox();
  expect(startBox).not.toBeNull();
  await page.mouse.move(startBox!.x + startBox!.width / 2, startBox!.y + startBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(startBox!.x + startBox!.width / 2 + 40, startBox!.y + startBox!.height / 2, { steps: 8 });
  await page.mouse.up();

  expect(Number(await startInput.inputValue())).toBeGreaterThan(startBefore);
  expect(Number(await endInput.inputValue())).toBe(endAfter);
});

/** Notices overlay as floating toasts and never take layout space away from the editor. */
test('notice is a floating overlay that does not resize the editor', async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => {
    const el = document.querySelector('#root > div > div');
    return Math.round(el?.getBoundingClientRect().height ?? 0);
  });

  // Re-picking the same file after a reload restores the cached project and
  // shows the "Restored..." notice without re-running analysis.
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'layout.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(SMOKE_VIDEO_BASE64, 'base64'),
  });
  const notice = page.getByRole('status');
  await expect(notice).toBeVisible({ timeout: 90_000 });

  const toastPosition = await page.evaluate(() => {
    const status = document.querySelector('[role="status"]');
    return status?.parentElement ? getComputedStyle(status.parentElement).position : null;
  });
  expect(toastPosition).toBe('absolute');

  const after = await page.evaluate(() => {
    const el = document.querySelector('#root > div > div');
    return Math.round(el?.getBoundingClientRect().height ?? 0);
  });
  expect(after).toBe(before);
});
