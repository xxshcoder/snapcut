# Testing

## Automated smoke test (T10.1)

`playwright.config.ts` runs a Chromium smoke test against the Vite dev server on
`http://127.0.0.1:4173`. The test uses a generated 70 s / 160×90 H.264 + AAC MP4
embedded as base64 in `e2e/fixtures/smoke-video.ts`, so no binary fixture or
network media is needed.

What it covers:

- Loads the real app and uploads the fixture through the file input.
- Mocks `GET /health`, `POST /transcribe` and `POST /highlights`; no API keys or
  live Groq/Gemini calls are involved.
- Asserts `/transcribe` receives multipart audio named `segment-0.*` and never
  receives the source video bytes or filename.
- Asserts `/highlights` receives the proxy contract (`minClipSec: 20`,
  `maxClipSec: 60`, `maxClips: 10`) and at least one transcript window.
- Waits for the mocked highlight to appear in the clip list, exports one clip,
  saves the download, and parses the MP4 boxes directly to assert:
  - duration between 20 s and 26 s (the snapped mocked clip is ~24 s), and
  - output aspect ratio 9:16.
- Pins `navigator.deviceMemory = 2` via `addInitScript` so the fast 540×960
  render profile is used; this still exercises the real crop/render/mux path.
- Skips with a clear message if required WebCodecs/OPFS APIs or H.264 encoding
  are unavailable in the browser.

Commands:

```bash
npx playwright test --list          # verify discovery/config only
npx playwright test                 # full smoke run; requires Playwright Chromium
npx playwright test --project=chromium --reporter=list
```

> Result: `npx playwright test --reporter=list` passed on 2026-11-22 with
> Playwright Chromium 159 (`1 passed`); the export assertion produced a 9:16 MP4
> with a ~24 s duration.

### Layout regression test (T9.2a)

`e2e/layout.spec.ts` loads the same mocked fixture at 1280×900, 1366×768 and
942×620 and asserts that the editor fills the whole browser window (width and
height equal the viewport), that the page itself cannot scroll
(`window.scrollY/X === 0`), and that all `design.md` regions and controls are
present (top bar, preview, timeline, properties tabs, tool rail, export button).
It also checks that the Timeline never scrolls its own tracks and that each
track label's top edge matches its lane. Two more tests drag the timeline trim
handles and assert the real clip start/end values change, and trigger a notice
to confirm it is a floating overlay that does not change the editor's height.

### Editing regression test (T9.3–T9.9)

`e2e/editing.spec.ts` uses the same mocked pipeline and covers the new editing
surface:

- A title edit and a trim are undone with `Ctrl+Z` and reapplied with
  `Ctrl+Shift+Z`, proving the history stack works for both typing and drags.
- Pressing `S` with the playhead inside the clip splits it; duplicate/delete
  buttons and undo/redo buttons keep the clip count and selection consistent.
- A transcript with deliberately long pauses produces multiple shorter clips
  through "Remove silences", and undo restores the original single clip.
- Audio, speed and caption-layout changes are applied to the real export; a 2×
  speed clip exports at roughly half the source duration (verified by parsing
  the MP4 `mvhd` duration).
- The worker-decoded filmstrip is the top row of the single timeline track and
  is wider than its lane, so it swipes/scrolls horizontally. Clicking a frame
  seeks to it, enables `Cut at frame`, and the cut creates two clips.
- The single clip bar is the only move/trim surface; dragging its start handle
  updates `Clip start`. Export still works with no clip checkbox ticked.
- A transcript with no removable pause produces an explicit no-op notice when
  "Remove silences" is pressed.

`e2e/layout.spec.ts` also verifies that the ruler scrubs, timeline zoom and
select-all/clear work, clip badges appear, preview audio can be auditioned, the
9:16 export inset expands, scrub ticks have unique labels, and transport
controls are not duplicated.

## Manual device matrix (T10.2)

### Devices / browsers

| ID | Device / browser | Version to test | Notes |
| --- | --- | --- | --- |
| D1 | Laptop Chrome (Windows or macOS) | latest stable desktop Chrome | Download path, 1080×1920 or low-memory 540×960 render. |
| D2 | Android Chrome | latest stable Chrome on a mid-range phone | Download path, mobile caps, background/visibility behaviour. |
| D3 | iPhone Safari | iOS 16.4+ | `navigator.share({ files })` / Photos path; no WebCodecs fallback assumptions. |

### Video types

| ID | Type | Suggested source | What it stresses |
| --- | --- | --- | --- |
| V1 | Talk | 5–15 min talking-head MP4 | Speech clarity, captions, centred crop. |
| V2 | Podcast | 10–30 min two-person MP4 | Multiple speakers, overlapping speech, long audio extraction. |
| V3 | Gameplay | 5–15 min 1080p screen capture | Busy frames, fast motion, high bitrate source. |
| V4 | Vlog | 5–15 min handheld MP4 | Shaky framing, varied lighting, tracked crop. |
| V5 | Lecture | 15–60 min slides + voice | Long segments, low speech rate, sentence boundaries. |

### Result matrix

Fill each cell with `Pass`, `Fail`, or `Blocked (reason)`.

| Device \ Video | V1 Talk | V2 Podcast | V3 Gameplay | V4 Vlog | V5 Lecture |
| --- | --- | --- | --- | --- | --- |
| D1 Laptop Chrome | Pending | Pending | Pending | Pending | Pending |
| D2 Android Chrome | Pending | Pending | Pending | Pending | Pending |
| D3 iPhone Safari | Pending | Pending | Pending | Pending | Pending |

### Detailed run record

| Run | Device | Video | Browser / OS version | Source (duration, resolution, codec) | Load + preview | Transcription (mocked or live) | Highlights | Export: duration / 9:16 / captions | Overall | Tester / date | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | D1 | V1 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R02 | D1 | V2 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R03 | D1 | V3 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R04 | D1 | V4 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R05 | D1 | V5 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R06 | D2 | V1 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R07 | D2 | V2 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R08 | D2 | V3 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R09 | D2 | V4 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R10 | D2 | V5 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R11 | D3 | V1 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R12 | D3 | V2 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R13 | D3 | V3 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R14 | D3 | V4 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |
| R15 | D3 | V5 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | |

### Manual procedure (per run)

1. Open the app with the Worker available (live run) or with the same mocks used
   by the smoke test (offline run). Record which one was used.
2. Pick the video. Confirm the preview plays, metadata appears, and the file is
   never shown as a request body in DevTools → Network.
3. Wait for analysis. Confirm progress phases are readable, cancel works if
   tested, and the browser stays responsive.
4. Confirm the Network tab shows only small audio segment uploads to
   `/transcribe` and transcript-window JSON to `/highlights` — never the source
   MP4.
5. Review at least one suggested clip: trim handles, 9:16 crop, caption style,
   and word edits persist after reload.
6. Export one clip. Confirm it downloads (D1/D2) or opens the iOS share sheet and
   can be saved to Photos (D3).
7. Verify the exported file: duration matches the chosen trim (±1 s), aspect is
   9:16, video plays, and captions are burned in and synced.
8. Note crashes, blank screens, missing messages, codec errors, memory growth,
   or share/download failures in the run record.

## Known issues / limitations

| ID | Area | Detail |
| --- | --- | --- |
| K1 | Test environment | Playwright Chromium 159 is installed locally and the full smoke test passed; real-device results below are still pending. |
| K2 | Local API | The Vite dev server proxies `/transcribe`, `/highlights` and `/health` to `127.0.0.1:8787`; the smoke test still mocks those routes, so it does not require a running Worker or API keys. |
| K3 | Codec support | H.264 `VideoEncoder` availability varies. The smoke test skips export assertions rather than failing when no supported AVC profile exists; desktop Firefox fallback to ffmpeg.wasm is manual-only. |
| K4 | Fixture | The generated fixture is silent and has no real speech; mocked words/highlights exercise the pipeline, not recognition or Gemini ranking quality. |
| K5 | Media features | Face tracking, `navigator.share`, wake lock and iOS Photos saving are browser/device dependent and are covered only by the manual matrix. |
| K6 | Duration check | The smoke test verifies a plausible clipped duration (20–26 s via `mvhd`) rather than frame-by-frame A/V sync; A/V sync is a manual check. |

## Final verification (2026-11-22)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 17 files, 137 tests |
| `npm run build` | Pass — static `dist/`, PWA service worker generated |
| `npx playwright test --reporter=list` | Pass — 1 export smoke test + 6 layout/interaction tests |
| Lighthouse (production preview) | Accessibility 1.00, Best Practices 1.00, SEO 1.00; no failures |
| PWA installability | Manifest, 192/512 icons, theme color and generated service worker verified in `dist/`; the browser tool does not expose Lighthouse's PWA category |
| Worker `GET /health` via `wrangler dev --local` | `200 {"ok":true}` |
| Worker `GET /health` with disallowed `Origin` | `403 {"error":"Origin not allowed","code":"forbidden"}` |
| Worker allowed local origins | `localhost:5173`, `127.0.0.1:5173`, `localhost:4173`, `127.0.0.1:4173` all return `200` with CORS headers; unknown origin still `403` |
| Vite preview proxy | `/transcribe`, `/highlights`, `/health` proxied to the Worker in `npm run preview` as well as `npm run dev` |
| Raw `fetch()` rejection | `/transcribe` and `/highlights` now surface an actionable `NetworkError` instead of "Failed to fetch" |
| Local mock mode | `MOCK_PROVIDERS=true` in gitignored `worker/.dev.vars`; `/transcribe` and `/highlights` return `200` with `X-Snapcut-Mock: true` without API keys; provider `fetch` is never called |
| Blob download lifetime | Anchor kept 60 s and object URL 5 min so large Chrome downloads are not aborted; e2e export still passes |
| UI usability audit | Playwright measured 1280×900 and 390×844: no horizontal overflow, all visible buttons ≥44 px, theme toggle 44×44, export button top-right, full-width clip strip, source and preview boxes equal height with content-fit widths |
| Trim controls | Playwright verified typing a start time, dragging the end handle, and clicking the timeline all update the clip range |
| design.md rebuild | `e2e/layout.spec.ts` verifies the editor fills 1280×900, 1366×768 and 942×620 with no page scroll, all dark-editor regions are visible, and notices float without resizing the layout |
| Functional editor polish | Properties controls are grouped and wired to the clip; tool rail and playback actions change real state; track labels align with lanes; dragging trim handles updates clip start/end; preview and timeline fill the left column |
| Export without ticking | Export stays enabled when no clip checkbox is ticked and exports the active clip (fallback: all clips) |
| `npx tsc -p tsconfig.worker.json --noEmit` | Pass |
| `npx wrangler deploy --dry-run` from `worker/` | Pass |
| `grep` API-key names/prefixes in `dist/` | No matches |

Manual-only checks remain listed as Pending in the device matrix: real Groq/Gemini curl calls (no keys available), real-device export and iOS Photos sharing, Firefox fallback, 1 GB/1 h media limits, and provider spend alerts.
