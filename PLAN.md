# PROJECT SPEC: Browser-only TikTok-style clip generator

> Instructions for the AI coding agent: read this whole file first. Work through tasks IN ORDER. Do not start a task until the previous task's "Done when" checks pass. After each task: run `npm run typecheck && npm run lint && npm test`, commit with the task ID (e.g. `T2.3: segment audio`), and tick the checkbox in this file. If something here conflicts with current library docs, trust the docs, note the deviation in `DECISIONS.md`, and continue. Do not add dependencies not listed here without recording why in `DECISIONS.md`.

## 1. Goal

A web app (phone + laptop) that takes a large local video, finds the best 20-60s moments, reframes them to 9:16, burns in animated captions, and exports clips. **All video processing happens in the user's browser. The video file is never uploaded. Only small audio segments and transcript text are sent to a thin API proxy.** Target cost: $0-$2/month.

## 2. Non-negotiable constraints

1. Never load a whole video into memory (`file.arrayBuffer()` on the source is forbidden). Use streaming/sliced reads.
2. No API keys in browser code. Keys live only in Cloudflare Worker secrets.
3. Must work on: desktop Chrome/Edge, Android Chrome, iOS Safari 16.4+. Firefox desktop uses the lazy ffmpeg.wasm fallback.
4. Heavy work runs in Web Workers; the UI thread must stay responsive.
5. One render at a time. Free every encoder/decoder/VideoFrame after use (`.close()`).
6. Mobile-first layout (design for 375px width first).
7. TypeScript strict mode. No `any` without a comment explaining why.
8. Everything must degrade gracefully: unsupported feature -> clear message, never a blank screen.

## 3. Tech stack

| Concern | Choice |
|---|---|
| App | Vite + React + TypeScript (strict), Tailwind CSS |
| Media engine | **Mediabunny** (WebCodecs) for demux/decode/encode/mux |
| Fallback engine | `@ffmpeg/ffmpeg` v0.12 (lazy-loaded, desktop only, unsupported-codec cases) |
| State | Zustand |
| Local storage | IndexedDB via `idb` (transcripts, project state); OPFS for temp clip output |
| Face tracking (late phase) | MediaPipe Tasks Vision (face detector), in a worker |
| PWA | `vite-plugin-pwa` |
| Proxy | Cloudflare Worker (TypeScript, `wrangler`) |
| Transcription | Groq Whisper API (via proxy) |
| Highlights | Gemini Flash API (via proxy) |
| Hosting | Cloudflare Pages (static) + Worker |
| Tests | Vitest (unit), Playwright (smoke e2e) |

Verify current package versions, Groq model name (currently `whisper-large-v3-turbo`), and the Gemini Flash model name against their docs at implementation time. Keep model names in one config constant so they are easy to change.

## 4. Repository layout

```
/
  PLAN.md  DECISIONS.md  README.md
  package.json  vite.config.ts  tsconfig.json
  public/_headers            # COOP/COEP (only if ffmpeg.wasm threads are used)
  src/
    main.tsx  App.tsx
    config.ts                # model names, limits, API base URL
    types.ts                 # shared types (section 5)
    lib/
      capabilities.ts        # feature detection
      fileSource.ts          # File -> Mediabunny input, hashing/id
      audio/extractAudio.ts  # stream-decode -> 16k mono -> encode
      audio/segment.ts       # split into 10-min segments w/ offsets
      transcribe/client.ts   # calls proxy, retry/backoff
      transcribe/merge.ts    # offset + merge words
      highlights/window.ts   # transcript -> windows
      highlights/prefilter.ts# local scoring
      highlights/client.ts   # calls proxy, validates JSON
      highlights/snap.ts     # snap to word/sentence boundaries
      render/renderClip.ts   # WebCodecs pipeline
      render/captions.ts     # draw word-by-word captions on canvas
      render/crop.ts         # crop path math (static + tracked)
      render/fallbackFfmpeg.ts
      track/faceTrack.ts     # MediaPipe sampling + smoothing
      storage/db.ts          # idb wrappers
      storage/opfs.ts
      export/save.ts         # download / navigator.share
    workers/                 # audio.worker.ts, render.worker.ts, track.worker.ts
    store/                   # zustand stores
    components/              # FilePicker, ProgressCard, ClipList, ClipEditor, CropBox, TrimBar, CaptionStylePicker, UnsupportedNotice
  worker/                    # Cloudflare Worker
    src/index.ts  wrangler.toml
  tests/  e2e/
```

## 5. Shared types (put in `src/types.ts`)

```ts
export type Word = { text: string; start: number; end: number }; // seconds, absolute in source video
export type Transcript = { fileId: string; language?: string; words: Word[]; durationSec: number };

export type AudioSegment = { index: number; offsetSec: number; durationSec: number; blob: Blob; mime: string };

export type Window = { id: number; start: number; end: number; text: string; prefilterScore: number };

export type Clip = {
  id: string;
  start: number; end: number;          // seconds in source
  title: string; hook: string;
  score: number;                       // 0-100
  crop: CropPath;                      // see below
  captionsEnabled: boolean;
  captionStyle: CaptionStyleId;
  words: Word[];                       // editable caption words within [start,end]
};

export type CropPath =
  | { mode: 'static'; x: number; y: number; w: number; h: number }          // normalized 0-1 of source frame, 9:16 aspect enforced
  | { mode: 'tracked'; keyframes: { t: number; x: number; y: number; w: number; h: number }[] };

export type CaptionStyleId = 'bold-pop' | 'minimal' | 'karaoke';
export type FileId = string; // hash of name+size+lastModified
```

## 6. Proxy API contract (Cloudflare Worker)

Common: JSON errors `{ error: string, code: string }`; CORS restricted to `ALLOWED_ORIGIN` env var; per-IP rate limit; reject bodies over limits.

**POST `/transcribe`**: `multipart/form-data` with `file` (audio blob, <= 5 MB) and `language` (optional).
Worker forwards to Groq `audio/transcriptions` with `response_format=verbose_json` and `timestamp_granularities[]=word`. Returns `{ words: {text,start,end}[], language: string, duration: number }` (times relative to the segment; the client adds the offset).

**POST `/highlights`**: JSON `{ windows: {id,start,end,text}[], minClipSec: 20, maxClipSec: 60, maxClips: number }`.
Worker calls Gemini with the prompt in section 8 and `responseMimeType: application/json`. Returns `{ clips: {start,end,title,hook,score}[] }`. Worker validates the shape before returning.

**GET `/health`** returns `{ ok: true }`.

Secrets: `GROQ_API_KEY`, `GEMINI_API_KEY`. Env: `ALLOWED_ORIGIN`, `MAX_AUDIO_BYTES`, `RATE_LIMIT_PER_MIN`, `DAILY_JOB_CAP`.
The provider call should live behind a small function per provider so it can be swapped.

## 7. Tasks

Legend: `[ ]` todo, `[x]` done. Each task has **Do** and **Done when**.

### Phase 0: Scaffold

- [x] **T0.1 Project init.** Do: Vite + React + TS strict, Tailwind, ESLint, Prettier, Vitest, Zustand, `idb`. Add scripts `dev`, `build`, `typecheck`, `lint`, `test`. Done when: `npm run build && npm test` pass on an empty app.
- [x] **T0.2 PWA + layout shell.** Do: `vite-plugin-pwa`, manifest, icons placeholder, mobile-first app shell with header and main area. Done when: Lighthouse PWA installable check passes locally.
- [x] **T0.3 Deploy pipeline.** Do: Cloudflare Pages config, README deploy steps. Done when: documented, `npm run build` output is static.
- [x] **T0.4 Worker scaffold.** Do: `worker/` with wrangler, `/health` route, CORS helper, rate-limit helper (use a Durable Object, KV, or Cloudflare's rate-limit binding; record the choice in DECISIONS.md). Done when: `wrangler dev` serves `/health` and rejects disallowed origins.

### Phase 1: File loading and capabilities

- [x] **T1.1 Capability detection** (`capabilities.ts`). Detect `VideoEncoder`, `VideoDecoder`, `AudioEncoder`, `AudioDecoder`, OPFS, Wake Lock, `navigator.share` with files, `OffscreenCanvas`, mobile vs desktop. Done when: unit tests cover detection with mocked globals; `UnsupportedNotice` shows a readable message listing what is missing.
- [ ] **T1.2 File picker + preview.** Do: `<input type="file" accept="video/*">` plus drag-and-drop (desktop); play with `URL.createObjectURL`; compute `FileId`; enforce size/duration caps from `config.ts` (phone: 1 GB / 60 min, desktop: 8 GB / 3 h; make configurable); revoke object URLs on cleanup. Done when: a 1 GB+ file plays on laptop and phone without a crash and without reading it into memory.
- [x] **T1.3 Project store + IndexedDB.** Do: `db.ts` with stores `transcripts`, `projects`; save/load by `FileId`. Done when: unit tests (fake-indexeddb) pass.

### Phase 2: Audio extraction

- [ ] **T2.1 Audio extraction worker.** Do: in `audio.worker.ts`, open the `File` with Mediabunny, stream-decode the audio track, downmix to mono, resample to 16 kHz, encode to Opus (fallback AAC if Opus unsupported; record which). Never buffer the entire decoded PCM; process in chunks. Done when: a 10-min test video yields a valid audio blob; peak memory stays flat (verify manually via DevTools).
- [x] **T2.2 Segmenting** (`segment.ts`). Do: produce ~10-minute segments (cut on silence if easy, otherwise hard cut with 1s overlap that is deduped in merge), each with `offsetSec`. Each segment must be <= 5 MB. Done when: unit test asserts offsets/durations sum to the source duration; a 1 h video produces ~6 segments.
- [x] **T2.3 Progress + wake lock UI.** Do: `ProgressCard` with percent, ETA, cancel; request Screen Wake Lock during processing; show "Keep this screen open" notice on mobile; handle `visibilitychange` (pause or warn). Done when: cancel stops work and frees resources.
- [ ] **T2.4 No-audio and weird-input handling.** Do: clear errors for videos with no audio track or unreadable codecs; offer the ffmpeg.wasm fallback on desktop. Done when: tested with a silent video.

### Phase 3: Proxy

- [ ] **T3.1 `/transcribe` route.** Do: validate size/type, forward to Groq, normalize response to contract, map errors (429 -> `code: "rate_limited"` with `retryAfterSec`). Done when: curl with a sample audio file returns words with timestamps.
- [ ] **T3.2 `/highlights` route.** Do: build the Gemini request with the prompt in section 8, force JSON output, validate/clean the result (drop clips outside window bounds, enforce length), return contract shape. Done when: curl with sample windows returns valid clips.
- [x] **T3.3 Abuse limits.** Do: per-IP rate limit, daily job cap, max body size, strict CORS, no key leakage in errors or logs. Done when: automated tests (miniflare/vitest) prove limits trigger and bad origins are rejected.

### Phase 4: Transcription

- [x] **T4.1 Client** (`transcribe/client.ts`). Do: upload segments sequentially, retry with exponential backoff + jitter (respect `retryAfterSec`), resumable (persist completed segment results in IndexedDB as they finish). Done when: killing the network mid-run and resuming completes without redoing finished segments.
- [x] **T4.2 Merge** (`merge.ts`). Do: add `offsetSec` to each word, dedupe overlap region, sort, return `Transcript`. Done when: unit tests cover overlap dedupe and monotonic timestamps.
- [x] **T4.3 Cache.** Do: store final transcript by `FileId`; on load, skip all of Phase 2 and 4 if cached. Done when: re-opening the same file shows the transcript instantly.

### Phase 5: Highlights

- [x] **T5.1 Windowing** (`window.ts`). Do: group words into 60-90s windows that end on sentence boundaries (use punctuation in the word text; fall back to long pauses > 0.7s). Done when: unit tests.
- [x] **T5.2 Prefilter** (`prefilter.ts`). Do: score windows by speech rate, question marks, exclamations, pause structure, and keyword/number density; keep the top ~25% (min 6 windows). Done when: unit tests with fixture transcripts.
- [x] **T5.3 Highlights client + snapping** (`client.ts`, `snap.ts`). Do: call `/highlights`, validate with zod (add `zod`, record in DECISIONS.md), snap start to the nearest word start at a sentence boundary and end to a word end, enforce 20-60s, drop overlaps (keep higher score). Done when: returns 5-10 clips for a 1 h fixture and all clips pass invariants in tests.

### Phase 6: Editor UI

- [x] **T6.1 Clip list.** Mobile bottom sheet / desktop side panel; shows title, duration, score; tap seeks preview to the clip start and loops the clip. Done when: works at 375px and 1440px.
- [x] **T6.2 Trim bar.** Touch-friendly handles (min 44px hit target), snaps to word boundaries, shows the exact start/end times. Done when: trimming updates the preview loop live.
- [x] **T6.3 Crop box.** Draggable (and pinch/scroll-zoom) 9:16 overlay on the preview, normalized coords stored in `Clip.crop`; default centered. Done when: crop persists in the project and matches the export.
- [x] **T6.4 Caption editor.** Edit word text, toggle captions, pick a style (`CaptionStylePicker`); live preview overlay on the video using the same drawing code as render (`captions.ts`). Done when: preview and exported frames look the same.
- [x] **T6.5 Persist projects.** Save clip edits to IndexedDB on change (debounced). Done when: reload restores all edits.

### Phase 7: Rendering

- [ ] **T7.1 Render pipeline** (`renderClip.ts`, `render.worker.ts`). Do: with Mediabunny, seek to the clip start (nearest keyframe, then decode forward and discard frames before start), decode video, draw each frame to an `OffscreenCanvas` with crop+scale to the target size (phone 720x1280, desktop 1080x1920), overlay captions, encode H.264 (check `VideoEncoder.isConfigSupported`, fall back across profiles/levels), encode AAC audio for the same range, mux to MP4. Apply backpressure (do not queue unbounded frames). Done when: a 30s clip exports with synced A/V on laptop and a real phone.
- [x] **T7.2 Captions drawing** (`captions.ts`). Do: draw the current word group (3-5 words) centered in the lower third, highlight the active word, stroke for readability, font bundled locally (no external requests); 3 presets. Done when: unit-testable pure functions for layout; visual check.
- [ ] **T7.3 Output + export** (`opfs.ts`, `save.ts`). Do: write output to OPFS (not RAM), then offer: download (desktop/Android), `navigator.share({files})` (iOS), and "export all" as sequential downloads (add zip later). Clean OPFS after export. Done when: the exported file can be saved to Photos on iOS and plays correctly.
- [x] **T7.4 Render queue.** Do: render selected clips one at a time with per-clip progress, cancel, retry; free codecs between clips. Done when: exporting 5 clips back to back does not grow memory.

### Phase 8: Hardening

- [x] **T8.1 Resume + lifecycle.** Do: persist job state so a reload resumes at the last completed step; Wake Lock re-acquire on `visibilitychange`; warn before closing a tab mid-job. Done when: reload mid-transcription resumes.
- [x] **T8.2 Error taxonomy.** Do: typed errors (`UnsupportedCodec`, `OutOfMemory`, `ApiRateLimited`, `Network`, `Cancelled`) mapped to friendly UI messages with a suggested action. Done when: each is triggered in a test and shown correctly.
- [ ] **T8.3 ffmpeg.wasm fallback** (`fallbackFfmpeg.ts`). Do: lazy-load only when WebCodecs is unavailable or a codec is unsupported, desktop only, `WORKERFS` mount for the input, same `Clip` -> output contract (crop + trim; captions via `subtitles` filter with a bundled font or skip with a notice). Add `public/_headers` for COOP/COEP only if threads are enabled. Done when: works on desktop Firefox.
- [ ] **T8.4 Limits and low-end behavior.** Do: lower resolution/bitrate on low-memory devices (`navigator.deviceMemory` when available), refuse over-cap files with a clear message. Done when: tested with an over-cap file.

### Phase 9: Face tracking and polish

- [ ] **T9.1 Face tracking** (`faceTrack.ts`, `track.worker.ts`). Do: sample the clip's range at 2 fps from a low-res decode, run MediaPipe face detection, pick the dominant face, smooth with a moving average/Kalman, clamp the crop inside the frame, output a `tracked` `CropPath`. Fallback to `static` if no face. Add a "Auto-follow speaker" toggle. Done when: crop follows a speaker in a test clip without jitter.
- [x] **T9.2 Polish.** Do: dark/light theme, empty/loading states, accessibility pass (labels, focus, contrast), privacy note ("Video stays on your device; only audio is sent for transcription"), PWA install prompt. Done when: Lighthouse accessibility >= 90.
- [x] **T9.2a Rebuild UI from `design.md`.** Do: replace the earlier layout with the dark video-editor design — full-window app shell (no page scrolling), top bar with project title / settings / Export, preview pane with floating tool rail and caption overlay, timeline with ruler/playhead/tracks, properties panel with tabs/sliders/cover drop zone, and floating toast notices. Keep the e2e accessible names and privacy guarantees. Done when: `e2e/layout.spec.ts` verifies the editor fills 1280×900 and 1366×768 with no scroll, shows all design regions, and keeps notices as non-layout overlays (see D22/D23).
- [x] **T9.2b Make the editor controls real, aligned and full-height.** Do: replace present-only properties controls with grouped, functional timing/caption/framing controls and sticky actions; make the preview tool rail scrollable, draggable and action-driven; restyle the playback bar into one compact row; align timeline labels with their lanes; let the preview and timeline fill the left column vertically; keep Export enabled when no clip checkbox is ticked. Done when: typecheck/lint/unit/build pass and `e2e/layout.spec.ts` covers trims, alignment and floating notices at three viewport sizes (see D24–D27).
- [x] **T9.3 Undo/redo and keyboard shortcuts.** Do: keep a bounded history of clip edits in the store (coalescing drags/typing), expose `undo`/`redo`, and add global shortcuts for them plus editing/navigation keys that never fire while typing. Done when: e2e verifies undo/redo restores a title edit and a trim (see D28).
- [x] **T9.4 Clip operations.** Do: add split-at-playhead, duplicate and delete actions to the store and timeline, with selection and history kept consistent. Done when: e2e verifies split creates two clips, duplicate/delete work, and undo reverts them (see D29).
- [x] **T9.5 Remove silences.** Do: detect long gaps from word timestamps and replace the clip with shorter keep-ranges, preserving crop/caption style and adding a notice when no gap is found. Done when: e2e verifies a mocked transcript with a long pause produces multiple clips (see D30).
- [x] **T9.6 Audio controls.** Do: add per-clip volume, mute and fade in/out to the properties panel and apply them to the exported audio mix; keep source audio local. Done when: e2e verifies the controls update the clip and the renderer contract carries them (see D31/D32).
- [x] **T9.7 Clip speed.** Do: add per-clip speed from 0.5× to 2×, remap source time and caption timing in preview and export, and constrain trims so the source range stays valid. Done when: e2e verifies a speed change affects the exported duration contract (see D31/D32).
- [x] **T9.8 Caption layout.** Do: add font size, vertical position and background/outline controls to the properties panel and use the same style object in preview and renderer. Done when: e2e verifies the controls update the clip and the caption renderer receives the chosen layout (see D33/D34).
- [x] **T9.9 Frame-accurate filmstrip and cuts.** Do: decode a low-res frame strip in a worker and rebuild the timeline as one usable track (ruler, swipeable frames, single clip bar with trim handles); clicking a frame seeks exactly to it, arrow/frame buttons step one frame, and `Cut at frame` (or `X`) splits on that frame boundary. Remove duplicate lanes and non-essential timeline controls. Done when: e2e verifies the strip scrolls, a frame click enables the cut, the cut creates two clips, and the trim handles change `Clip start` (see D35–D38).

### Phase 10: Test and launch

- [x] **T10.1 E2E smoke tests** (Playwright with a small fixture video): load -> transcribe (mock the proxy) -> highlights (mock) -> export one clip -> assert the output has expected duration and a 9:16 aspect.
- [x] **T10.2 Device matrix** (manual checklist in `TESTING.md`): laptop Chrome, Android Chrome, iPhone Safari x 5 videos (talk, podcast, gameplay, vlog, lecture). Record results and known issues.
- [ ] **T10.3 Ops.** Set spend alerts on Groq/Google accounts; document secrets setup, deploy steps, and how to swap providers in `README.md`.

## 8. Gemini highlight prompt (use as the Worker's system prompt)

```
You pick the best short-form video clips from a transcript.
Input: a JSON list of windows with id, start, end (seconds) and text.
Return ONLY JSON: {"clips":[{"start":number,"end":number,"title":string,"hook":string,"score":number}]}
Rules:
- Each clip is between {minClipSec} and {maxClipSec} seconds long and lies within the span of the windows provided.
- A clip must start at the beginning of a sentence and end at the end of a sentence.
- A clip must make sense on its own with no earlier context.
- Prefer: a strong first sentence (a hook), a surprising claim, a story with a payoff, a clear tip, strong emotion, or a quotable line.
- Avoid: greetings, sponsor reads, filler, mid-thought cuts.
- title: max 8 words. hook: the single most compelling sentence from the clip.
- score: 0-100 for how likely the clip is to hold attention.
- Return at most {maxClips} clips, no overlaps, best first.
```

## 9. Definition of done (whole project)

- Full flow works on desktop Chrome, Android Chrome, and iOS Safari.
- A 1-hour source yields 5-10 usable clips; each clip exports as 9:16 MP4 with synced captions.
- The source video is never uploaded; the Network tab shows only audio segments and transcript text.
- No API keys in the built bundle (`grep` the `dist/` folder to confirm).
- `npm run typecheck && npm run lint && npm test` and the e2e smoke test pass.
- `README.md` explains setup, deploy, secrets, and limits. `DECISIONS.md` lists every deviation.

## 10. Notes for the agent

- Prefer small, pure, unit-testable functions for logic (windowing, snapping, merging, crop math). Keep browser-API code thin.
- When unsure about a Mediabunny or MediaPipe API, read the current official docs rather than guessing, and add a short note to `DECISIONS.md`.
- WebCodecs encoder support varies by device. Always check `isConfigSupported` and walk a fallback list of configs.
- If a task is too large, split it into sub-tasks in this file (e.g. `T7.1a`, `T7.1b`) and continue.
- Do not do anything beyond the task list (no accounts, billing, or backend storage) unless asked.
