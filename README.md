# Snapcut

Browser-only TikTok-style clip generator. Pick a large local video, transcribe its audio through a thin proxy, ask Gemini for the best moments, trim/crop/caption them, and export 9:16 MP4s. **The source video never leaves your device.**

## Features

- Streaming, lazy reads of multi-gigabyte files (no `arrayBuffer()` on the source).
- WebCodecs/Mediabunny audio extraction, transcription, highlight selection and rendering.
- 10-minute audio segments (< 5 MB each), resumable transcription, transcript caching by file id.
- Sentence-aware windows, local prefiltering, zod-validated highlights, word-boundary snapping.
- Mobile-first editor: trim bar, 9:16 crop box, three caption styles, optional face tracking.
- Sequential render queue writing to OPFS, then download or `navigator.share`.
- PWA installable, graceful fallback messages, ffmpeg.wasm fallback for desktop Firefox.

## Setup

```bash
npm install
npm run dev            # http://localhost:5173
```

In a second terminal, run the API proxy:

```bash
cd worker
wrangler dev           # http://localhost:8787
```

The Vite dev server forwards `/transcribe`, `/highlights` and `/health` to the Worker (see `vite.config.ts`). The same proxy is configured for `npm run preview`. In production set `VITE_API_BASE_URL` to your Worker origin, or deploy both on the same Cloudflare account so requests are same-origin.

### Troubleshooting: "Cannot reach the analysis API" / "Failed to fetch"

This means the browser never received an HTTP response from `/transcribe` or `/highlights`.

1. Make sure the Worker is running in a second terminal:
   ```bash
   cd worker && npx wrangler dev --local --port 8787
   ```
   Verify with `curl http://127.0.0.1:8787/health` → `{"ok":true}`.
2. Use an allowed origin. Local development allows `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4173` and `http://127.0.0.1:4173` via the comma-separated `ALLOWED_ORIGIN` var in `worker/wrangler.toml`. Change it to your deployed app origin and redeploy the Worker for production.
3. Leave `VITE_API_BASE_URL` empty when using the Vite dev/preview proxy. If you set it to a dead Worker URL, `fetch()` will reject before CORS.
4. Restart both servers after changing `ALLOWED_ORIGIN` or `.env`.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck project references + static production build into `dist/` |
| `npm run typecheck` | TypeScript strict check (app, config, worker) |
| `npm run lint` | ESLint 10 |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright smoke test (requires `npx playwright install chromium`) |

## Deploy

1. Copy `.env.example` to `.env` if you need to override public asset URLs or point the app at a separate Worker. Never put API secrets in `.env`.
2. `npm run build` — output in `dist/` is entirely static. Root `wrangler.toml` sets `pages_build_output_dir = "dist"`.
3. Cloudflare Pages: connect the repo, framework preset `Vite`, build command `npm run build`, output `dist`.
4. Add `VITE_API_BASE_URL=https://<your-worker>.<subdomain>.workers.dev` as a Pages build environment variable.
5. Deploy the Worker: `cd worker && wrangler deploy`.
6. Set Worker secrets (never in `src/`):

   ```bash
   wrangler secret put GROQ_API_KEY
   wrangler secret put GEMINI_API_KEY
   ```

7. Set Worker vars in `wrangler.toml` (or `wrangler secret put` for sensitive values): `ALLOWED_ORIGIN`, `MAX_AUDIO_BYTES`, `RATE_LIMIT_PER_MIN`, `DAILY_JOB_CAP`.
8. Bind the `RATE_LIMITER` Durable Object (already declared in `wrangler.toml`).

## Privacy

- Only compressed audio segments and transcript text are sent to the proxy. The video file itself is never uploaded.
- API keys exist only as Worker secrets. `grep -r api_key dist/` should find nothing.
- Transcripts and projects are stored locally in IndexedDB; rendered clips are written to OPFS.

## Limits

| Device | Max file | Max duration |
| --- | --- | --- |
| Phone | 1 GB | 60 min |
| Desktop | 8 GB | 180 min |

Audio segments are ~10 min and capped at 5 MB. Clips are 20–60 s. These values are in `src/config.ts`.

## Costs

Groq `whisper-large-v3-turbo` is roughly $0.04/hour of audio; Gemini Flash highlight calls are a few cents per hour of video. Expected cost for occasional personal use is $0–$2/month. Set spend alerts on both provider accounts.

## Swapping providers

Model names and the highlight prompt live in `src/shared/constants.ts` (re-exported by `src/config.ts`); provider calls live behind `transcribeWithGroq()` and `requestGeminiHighlights()` in `worker/src/providers.ts`. Replace those functions and the corresponding constant; no browser code needs to change.

See `DECISIONS.md` for deviations from `PLAN.md` and `TESTING.md` for the manual device matrix.
