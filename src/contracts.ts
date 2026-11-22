import { z } from 'zod';

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  retryAfterSec: z.number().optional(),
});

export const transcribeResponseSchema = z.object({
  words: z.array(
    z.object({
      text: z.string(),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().nonnegative(),
    }),
  ),
  language: z.string(),
  duration: z.number().finite().nonnegative(),
});

export const highlightWindowSchema = z.object({
  id: z.number().int().nonnegative(),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(),
  text: z.string(),
});

export const highlightsRequestSchema = z.object({
  windows: z.array(highlightWindowSchema).min(1),
  minClipSec: z.number().positive(),
  maxClipSec: z.number().positive(),
  maxClips: z.number().int().positive(),
});

export const rawClipSchema = z.object({
  start: z.number().finite(),
  end: z.number().finite(),
  title: z.string(),
  hook: z.string(),
  score: z.number().finite(),
});

export const highlightsResponseSchema = z.object({ clips: z.array(rawClipSchema) });

export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;
export type HighlightsRequest = z.infer<typeof highlightsRequestSchema>;
export type HighlightsResponse = z.infer<typeof highlightsResponseSchema>;
export type RawClip = z.infer<typeof rawClipSchema>;
