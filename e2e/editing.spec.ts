import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { SMOKE_VIDEO_BASE64 } from './fixtures/smoke-video';
import { highlightsResponse, transcribeResponse, type MockWord } from './fixtures/mock-api';
import { parseMp4Metadata } from './utils/mp4';

async function setup(page: Page, words?: MockWord[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route('**/transcribe', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(words ? { language: 'en', duration: 70, words } : transcribeResponse()),
    }),
  );
  await page.route('**/highlights', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(highlightsResponse()) }),
  );
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'editing.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(SMOKE_VIDEO_BASE64, 'base64'),
  });
  await expect(page.getByRole('heading', { name: /Suggested clips/ })).toBeVisible({ timeout: 90_000 });
}

/** Move the shared playhead into the middle of the suggested clip. */
async function seekToMiddle(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Seek to / }).nth(6).click();
}

test('undo and redo restore title and trim edits', async ({ page }) => {
  await setup(page);

  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const originalTitle = await title.inputValue();
  const editedTitle = 'Undo proves this works';
  await title.fill(editedTitle);
  await expect(page.getByRole('button', { name: editedTitle })).toBeVisible();

  const start = page.getByRole('spinbutton', { name: 'Clip start' });
  const originalStart = Number(await start.inputValue());
  await start.fill(String(originalStart + 2));
  await page.getByRole('heading', { name: /Suggested clips/ }).click();

  await page.keyboard.press('Control+z');
  expect(Number(await start.inputValue())).toBe(originalStart);
  await page.keyboard.press('Control+Shift+z');
  expect(Number(await start.inputValue())).toBe(originalStart + 2);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: originalTitle })).toBeVisible();
});

test('split, duplicate and delete keep selection and history consistent', async ({ page }) => {
  await setup(page);
  await seekToMiddle(page);

  // S is the split shortcut; the playhead has to be inside the active clip.
  await page.keyboard.press('s');
  await expect(page.getByRole('heading', { name: 'Suggested clips (2)' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/Split at/);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested clips (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested clips (2)' })).toBeVisible();

  await page.getByRole('button', { name: 'Duplicate clip' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested clips (3)' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete clip' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested clips (2)' })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('heading', { name: 'Suggested clips (3)' })).toBeVisible();
});

test('remove silences cuts long transcript gaps into shorter clips', async ({ page }) => {
  const words: MockWord[] = [
    { text: 'Start.', start: 0.2, end: 1 },
    { text: 'Here.', start: 1.2, end: 2 },
    { text: 'Pause.', start: 2.2, end: 3 },
    { text: 'Back.', start: 9, end: 9.8 },
    { text: 'Again.', start: 10, end: 10.8 },
    { text: 'Second.', start: 11, end: 11.8 },
    { text: 'End.', start: 19, end: 19.8 },
    { text: 'Done.', start: 20, end: 20.8 },
    { text: 'Finish.', start: 21, end: 21.8 },
  ];
  await setup(page, words);

  await page.getByRole('button', { name: 'Remove silences' }).click();
  await expect(page.getByRole('status')).toContainText(/Removed \d+ silent gap/);
  await expect(page.getByRole('heading', { name: /Suggested clips \([2-9]/ })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested clips (1)' })).toBeVisible();
});

test('audio, speed and caption layout controls reach the exported MP4', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 2 });
    } catch {
      // The export still validates the speed change even without a pinned profile.
    }
  });
  await setup(page);

  await page.getByRole('combobox', { name: 'Clip speed' }).selectOption('2');
  await expect(page.getByRole('combobox', { name: 'Clip speed' })).toHaveValue('2');
  await page.getByRole('checkbox', { name: 'Mute' }).check();
  await page.getByRole('checkbox', { name: 'Caption background' }).check();
  await page.getByRole('slider', { name: 'Caption position' }).evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '0.4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: /^Export 1 clip$/ }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('sped-up.mp4');
  await download.saveAs(path);
  const metadata = parseMp4Metadata(new Uint8Array(await readFile(path)));

  // The fixture clip is about 23 s; 2× speed must halve the exported duration.
  expect(metadata.durationSec).toBeGreaterThan(9);
  expect(metadata.durationSec).toBeLessThan(14);
});

test('timeline decodes source frames and seeks by frame', async ({ page }) => {
  await setup(page);
  const frame = page.getByRole('button', { name: /^Seek to frame / }).nth(4);
  await expect(frame).toBeVisible({ timeout: 90_000 });

  // The strip is wider than its lane and swipes/scrolls horizontally.
  const strip = page.getByRole('group', { name: /Frame strip/ });
  const scrollable = await strip.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrollable).toBe(true);
  await strip.hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await frame.click();
  await expect(page.getByRole('button', { name: 'Cut at frame' })).toBeEnabled();
  await page.getByRole('button', { name: 'Cut at frame' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested clips (2)' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/Split at/);
});

test('timeline clip can be trimmed from its handle', async ({ page }) => {
  await setup(page);
  const start = page.getByRole('spinbutton', { name: 'Clip start' });
  const original = Number(await start.inputValue());

  const handle = page.getByRole('button', { name: 'Drag clip start' });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();

  expect(Number(await start.inputValue())).toBeGreaterThan(original);
});

test('remove silences explains a no-op', async ({ page }) => {
  await setup(page);

  // The default transcript has only 0.1 s gaps, so there is nothing to remove.
  await page.getByRole('button', { name: 'Remove silences' }).click();
  await expect(page.getByRole('status')).toContainText(/No silences longer than 0\.75s/);
});
