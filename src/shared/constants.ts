/**
 * Environment-independent constants shared by the browser app and the Worker.
 * Keep this module free of `import.meta.env` and DOM-only APIs so both bundles
 * can import it safely.
 */

export const MODELS = {
  /** Groq Speech-to-Text (confirmed current as of 2026-11). */
  transcription: 'whisper-large-v3-turbo',
  /** Current stable Flash model; 2.5 Flash is deprecated. */
  highlights: 'gemini-3.8-flash',
} as const;

export const HIGHLIGHT_SYSTEM_PROMPT = `You pick the best short-form video clips from a transcript.
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
- Return at most {maxClips} clips, no overlaps, best first.`;
