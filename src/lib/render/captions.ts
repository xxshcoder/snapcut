import { RENDER } from '../../config';
import type { CaptionLayoutOptions, CaptionStyleId, Word } from '../../types';

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type WordLayout = { word: Word; text: string; x: number; width: number; active: boolean };
export type CaptionLayout = { words: WordLayout[]; fontSize: number; left: number; y: number; style: CaptionStyleId };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Choose the 3-5 words surrounding the active word. */
export function captionGroup(words: Word[], t: number, groupSize = 4): { group: Word[]; activeIndex: number } {
  if (words.length === 0) return { group: [], activeIndex: -1 };
  let active = words.findIndex((w) => t >= w.start && t < w.end);
  if (active < 0) active = words.findIndex((w) => w.start > t);
  if (active < 0) active = words.length - 1;
  const from = Math.max(0, active - Math.floor(groupSize / 2));
  const group = words.slice(from, Math.min(words.length, from + groupSize));
  return { group, activeIndex: active - from };
}

export function layoutCaptions(
  ctx: Canvas2D,
  words: Word[],
  t: number,
  width: number,
  height: number,
  style: CaptionStyleId,
  options?: CaptionLayoutOptions,
): CaptionLayout {
  const { group, activeIndex } = captionGroup(words, t);
  const scale = Number.isFinite(options?.fontSize) ? clamp(options!.fontSize!, 0.6, 1.8) : 1;
  let fontSize = Math.round(width * 0.062 * scale);
  ctx.font = `800 ${fontSize}px ${RENDER.captionFont}`;
  const gap = fontSize * 0.28;
  let total = group.reduce((sum, word) => sum + ctx.measureText(word.text.trim()).width + gap, -gap);
  while (total > width * 0.9 && fontSize > width * 0.03) {
    fontSize -= 2;
    ctx.font = `800 ${fontSize}px ${RENDER.captionFont}`;
    total = group.reduce((sum, word) => sum + ctx.measureText(word.text.trim()).width + gap, -gap);
  }
  const left = (width - total) / 2;
  const position = Number.isFinite(options?.position) ? clamp(options!.position!, 0.2, 0.95) : 0.78;
  const y = height * position;
  let cursor = left;
  const laidOut = group.map((word, index): WordLayout => {
    const text = word.text.trim();
    const wordWidth = ctx.measureText(text).width;
    const item = { word, text, x: cursor, width: wordWidth, active: index === activeIndex };
    cursor += wordWidth + gap;
    return item;
  });
  return { words: laidOut, fontSize, left, y, style };
}

/** Shared by the live preview and the renderer, so both look identical. */
export function drawCaptions(
  ctx: Canvas2D,
  words: Word[],
  t: number,
  width: number,
  height: number,
  style: CaptionStyleId,
  options?: CaptionLayoutOptions,
): CaptionLayout | null {
  if (words.length === 0) return null;
  const layout = layoutCaptions(ctx, words, t, width, height, style, options);
  ctx.save();
  ctx.font = `800 ${layout.fontSize}px ${RENDER.captionFont}`;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  if (style === 'minimal' || options?.background) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(layout.left - layout.fontSize * 0.4, layout.y - layout.fontSize * 0.25,
      layout.words.reduce((s, w) => s + w.width, 0) + Math.max(0, layout.words.length - 1) * layout.fontSize * 0.28 + layout.fontSize * 0.8,
      layout.fontSize * 1.5);
  }

  const outline = Number.isFinite(options?.outline) ? clamp(options!.outline!, 0, 3) : 1;
  for (const item of layout.words) {
    ctx.lineWidth = layout.fontSize * (style === 'bold-pop' ? 0.18 : 0.11) * outline;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(item.text, item.x, layout.y);
    ctx.fillStyle =
      item.active && style === 'karaoke'
        ? '#ffd23f'
        : item.active && style === 'bold-pop'
          ? '#ffffff'
          : style === 'minimal'
            ? '#f5f5f5'
            : '#ffffff';
    if (item.active && style === 'bold-pop') {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.65)';
      ctx.shadowBlur = layout.fontSize * 0.35;
    }
    ctx.fillText(item.text, item.x, layout.y);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  return layout;
}
