import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { SMOKE_VIDEO_BASE64 } from './fixtures/smoke-video';
import { highlightsResponse, MOCK_RAW_CLIP, transcribeResponse } from './fixtures/mock-api';
import { parseMp4Metadata } from './utils/mp4';

const SOURCE_FILE_NAME = 'smoke-transcript.mp4';
const TARGET_ASPECT = 9 / 16;
const H264_CODECS = ['avc1.640028', 'avc1.4d401f', 'avc1.42001f', 'avc1.42e01e', 'avc1.42000d'] as const;

type HighlightsPayload = {
  windows: unknown[];
  minClipSec: number;
  maxClipSec: number;
  maxClips: number;
};

function parseHighlightsPayload(raw: string | null): HighlightsPayload {
  const parsed: unknown = JSON.parse(raw ?? '{}');
  if (typeof parsed !== 'object' || parsed === null) throw new Error('/highlights body was not an object');
  const value = parsed as Record<string, unknown>;
  if (
    !Array.isArray(value.windows) ||
    typeof value.minClipSec !== 'number' ||
    typeof value.maxClipSec !== 'number' ||
    typeof value.maxClips !== 'number'
  ) {
    throw new Error('/highlights body did not match the proxy contract');
  }
  return {
    windows: value.windows,
    minClipSec: value.minClipSec,
    maxClipSec: value.maxClipSec,
    maxClips: value.maxClips,
  };
}

async function requireBrowserFeatures(page: Page): Promise<void> {
  const features = await page.evaluate(() => ({
    videoDecoder: typeof VideoDecoder !== 'undefined',
    videoEncoder: typeof VideoEncoder !== 'undefined',
    audioDecoder: typeof AudioDecoder !== 'undefined',
    audioEncoder: typeof AudioEncoder !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    opfs: typeof navigator.storage?.getDirectory === 'function',
  }));
  const missing = Object.entries(features)
    .filter(([, available]) => !available)
    .map(([name]) => name);
  if (missing.length > 0) {
    test.skip(true, `This browser is missing required media features: ${missing.join(', ')}`);
  }

  const canEncodeAudio = await page.evaluate(async () => {
    if (typeof AudioEncoder === 'undefined') return false;
    for (const codec of ['opus', 'mp4a.40.2']) {
      try {
        const supported = await AudioEncoder.isConfigSupported({
          codec,
          sampleRate: codec === 'opus' ? 16_000 : 48_000,
          numberOfChannels: 1,
          bitrate: codec === 'opus' ? 16_000 : 48_000,
        });
        if (supported.supported) return true;
      } catch {
        // Try the next codec.
      }
    }
    return false;
  });
  if (!canEncodeAudio) test.skip(true, 'This browser has no supported audio encoder for audio extraction');
}

async function canExportH264(page: Page): Promise<boolean> {
  return page.evaluate(async (codecs: readonly string[]) => {
    if (typeof VideoEncoder === 'undefined') return false;
    for (const codec of codecs) {
      try {
        const supported = await VideoEncoder.isConfigSupported({
          codec,
          width: 540,
          height: 960,
          bitrate: 1_500_000,
          framerate: 30,
        });
        if (supported.supported) return true;
      } catch {
        // Try the next profile.
      }
    }
    return false;
  }, H264_CODECS);
}

test('load -> mocked transcription -> mocked highlights -> export one 9:16 clip', async ({ page }, testInfo) => {
  let transcribeCalls = 0;
  let highlightCalls = 0;

  // Pin the small render profile so the smoke test stays fast; the output must still be exactly 9:16.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 2 });
    } catch {
      // If the property cannot be overridden, the test still validates 9:16 output.
    }
  });

  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/transcribe', async (route) => {
    transcribeCalls += 1;
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('multipart/form-data');

    const body = request.postDataBuffer();
    expect(body, 'the /transcribe request should carry an audio segment').not.toBeNull();
    if (body) {
      const multipart = body.toString('latin1');
      expect(multipart).toContain('name="file"');
      expect(multipart).toMatch(/filename="segment-0\.(ogg|m4a)"/);
      expect(multipart, 'the source video must never be uploaded').not.toContain(SOURCE_FILE_NAME);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(transcribeResponse()),
    });
  });

  await page.route('**/highlights', async (route) => {
    highlightCalls += 1;
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['content-type']).toContain('application/json');

    const payload = parseHighlightsPayload(request.postData());
    expect(payload.minClipSec).toBe(20);
    expect(payload.maxClipSec).toBe(60);
    expect(payload.maxClips).toBe(10);
    expect(payload.windows.length).toBeGreaterThan(0);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(highlightsResponse()),
    });
  });

  await page.goto('/');
  await requireBrowserFeatures(page);

  await test.step('loads the fixture and runs through the mocked API pipeline', async () => {
    await expect(page.getByRole('heading', { name: 'Pick a video to clip' })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: SOURCE_FILE_NAME,
      mimeType: 'video/mp4',
      lastModified: 1_700_000_000_000,
      buffer: Buffer.from(SMOKE_VIDEO_BASE64, 'base64'),
    });

    await expect(page.getByRole('heading', { name: /Suggested clips/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: new RegExp(MOCK_RAW_CLIP.title) })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Export clip 1' })).toBeChecked();

    expect(transcribeCalls, 'expected exactly one mocked /transcribe call').toBe(1);
    expect(highlightCalls, 'expected exactly one mocked /highlights call').toBe(1);
  });

  if (!(await canExportH264(page))) {
    test.skip(true, 'This browser cannot encode H.264 with VideoEncoder; export assertions skipped');
  }

  await test.step('exports one clip and inspects the downloaded MP4', async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /Export 1 clip\(s\)/ }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('smoke-transcript.mp4-clip-0-24.mp4');
    const exportedPath = testInfo.outputPath('exported-clip.mp4');
    await download.saveAs(exportedPath);

    const metadata = parseMp4Metadata(new Uint8Array(await readFile(exportedPath)));
    expect(metadata.durationSec).toBeGreaterThan(20);
    expect(metadata.durationSec).toBeLessThan(26);
    expect(metadata.width / metadata.height).toBeCloseTo(TARGET_ASPECT, 3);
    await expect(
      page.getByText(new RegExp(`${Math.round(metadata.width)}×${Math.round(metadata.height)}`)),
    ).toBeVisible();
  });
});
