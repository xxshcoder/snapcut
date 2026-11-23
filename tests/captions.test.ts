import { describe, expect, it } from 'vitest';
import { captionGroup, drawCaptions, layoutCaptions, type Canvas2D } from '../src/lib/render/captions';
import type { Word } from '../src/types';

type FillRecord = { text: string; fillStyle: string; shadowBlur: number };

type CaptionStub = {
  ctx: Canvas2D;
  state: {
    font: string;
    calls: string[];
    fills: FillRecord[];
    shadowBlur: number;
  };
};

/** Minimal CanvasRenderingContext2D stand-in: all text widths scale with the current font size. */
function createStub(): CaptionStub {
  const state: CaptionStub['state'] = { font: '', calls: [], fills: [], shadowBlur: 0 };
  const ctx = {
    get font() {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    get shadowBlur() {
      return state.shadowBlur;
    },
    set shadowBlur(value: number) {
      state.shadowBlur = value;
    },
    fillStyle: '',
    strokeStyle: '',
    textBaseline: '',
    lineJoin: '',
    miterLimit: 0,
    lineWidth: 0,
    shadowColor: '',
    measureText(text: string) {
      const pixels = Number(/(\d+)px/.exec(state.font)?.[1] ?? '10');
      return { width: text.length * pixels * 0.6 };
    },
    save() {
      state.calls.push('save');
    },
    restore() {
      state.calls.push('restore');
    },
    fillRect() {
      state.calls.push('fillRect');
    },
    strokeText(text: string) {
      state.calls.push(`strokeText:${text}`);
    },
    fillText(text: string) {
      state.calls.push(`fillText:${text}`);
      state.fills.push({ text, fillStyle: ctx.fillStyle, shadowBlur: state.shadowBlur });
    },
  };

  return { ctx: ctx as unknown as Canvas2D, state };
}

function words(texts: string[]): Word[] {
  return texts.map((text, index) => ({ text, start: index, end: index + 0.9 }));
}

describe('captionGroup', () => {
  it('returns no group for an empty transcript', () => {
    expect(captionGroup([], 1)).toEqual({ group: [], activeIndex: -1 });
  });

  it('centers a group of four words around the active word', () => {
    const all = words(['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);

    expect(captionGroup(all, 2.5)).toEqual({ group: all.slice(0, 4), activeIndex: 2 });
    expect(captionGroup(all, 7.5)).toEqual({ group: all.slice(5, 8), activeIndex: 2 });
    expect(captionGroup(all, 2.5, 5)).toEqual({ group: all.slice(0, 5), activeIndex: 2 });
  });

  it('selects the next word during a gap, and the last word after the transcript', () => {
    const all = [words(['a'])[0], words(['b'])[0], words(['c'])[0]].map((item, index) => ({
      text: item?.text ?? '',
      start: index * 2,
      end: index * 2 + 1,
    }));

    expect(captionGroup(all, 1.5)?.activeIndex).toBe(1);
    expect(captionGroup(all, 100).activeIndex).toBe(2);
    // The requested group size is capped by the number of available words.
    expect(captionGroup(all, 100).group).toEqual(all);
  });
});

describe('layoutCaptions', () => {
  it('centers the group in the lower third and marks the active word', () => {
    const { ctx, state } = createStub();
    const all = words(['one', 'two', 'three', 'four', 'five', 'six']);

    const layout = layoutCaptions(ctx, all, 2.5, 720, 1280, 'bold-pop');

    expect(layout.style).toBe('bold-pop');
    expect(layout.fontSize).toBe(45);
    expect(state.font).toContain('45px');
    expect(layout.words.map((item) => item.text)).toEqual(['one', 'two', 'three', 'four']);
    expect(layout.words.map((item) => item.active)).toEqual([false, false, true, false]);
    expect(layout.left).toBeCloseTo(138.6, 4);
    expect(layout.y).toBeCloseTo(1280 * 0.78, 5);
    expect(layout.words.map((item) => item.width)).toEqual([81, 81, 135, 108]);
    expect(layout.words[1]?.x).toBeCloseTo((layout.words[0]?.x ?? 0) + 81 + 45 * 0.28, 5);
    expect(layout.words[0]?.x).toBeCloseTo(layout.left, 5);
  });

  it('shrinks the font when a long group does not fit', () => {
    const { ctx, state } = createStub();
    const all = words(['x'.repeat(80)]);

    const layout = layoutCaptions(ctx, all, 0.5, 720, 1280, 'minimal');

    expect(layout.fontSize).toBeLessThan(45);
    expect(layout.fontSize).toBeGreaterThanOrEqual(21);
    expect(state.font).toContain(`${layout.fontSize}px`);
  });
});

describe('drawCaptions', () => {
  it('does nothing for an empty transcript', () => {
    const { ctx, state } = createStub();

    expect(drawCaptions(ctx, [], 0, 720, 1280, 'bold-pop')).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('strokes and fills every word, saving and restoring canvas state', () => {
    const { ctx, state } = createStub();
    const all = words(['one', 'two', 'three', 'four']);

    const layout = drawCaptions(ctx, all, 2.5, 720, 1280, 'bold-pop');

    expect(layout?.words).toHaveLength(4);
    expect(state.calls[0]).toBe('save');
    expect(state.calls.at(-1)).toBe('restore');
    expect(state.calls.filter((call) => call.startsWith('strokeText:'))).toHaveLength(4);
    expect(state.calls.filter((call) => call.startsWith('fillText:'))).toHaveLength(4);
    expect(state.fills.find((fill) => fill.text === 'three')?.fillStyle).toBe('#ffffff');
    expect(state.fills.find((fill) => fill.text === 'three')?.shadowBlur).toBeGreaterThan(0);
    expect(state.fills.find((fill) => fill.text === 'one')?.shadowBlur).toBe(0);
    const canvas = ctx as unknown as { textBaseline: string; lineJoin: string; miterLimit: number };
    expect(canvas.textBaseline).toBe('top');
    expect(canvas.lineJoin).toBe('round');
    expect(canvas.miterLimit).toBe(2);
  });

  it('highlights the active word for karaoke and draws a backing box for minimal', () => {
    const all = words(['one', 'two', 'three', 'four']);

    const karaoke = createStub();
    drawCaptions(karaoke.ctx, all, 2.5, 720, 1280, 'karaoke');
    expect(karaoke.state.fills.find((fill) => fill.text === 'three')?.fillStyle).toBe('#ffd23f');
    expect(karaoke.state.fills.find((fill) => fill.text === 'two')?.fillStyle).toBe('#ffffff');

    const minimal = createStub();
    drawCaptions(minimal.ctx, all, 2.5, 720, 1280, 'minimal');
    expect(minimal.state.calls.filter((call) => call === 'fillRect')).toHaveLength(1);
    expect(minimal.state.fills.every((fill) => fill.fillStyle === '#f5f5f5')).toBe(true);
  });

  it('honours font size, position, background and outline options', () => {
    const all = words(['one', 'two', 'three', 'four']);
    const styled = createStub();
    const layout = drawCaptions(
      styled.ctx,
      all,
      2.5,
      720,
      1280,
      'bold-pop',
      { fontSize: 1.5, position: 0.4, background: true, outline: 2 },
    );

    expect(layout?.fontSize).toBeGreaterThan(45);
    expect(layout?.y).toBeCloseTo(1280 * 0.4, 5);
    expect(styled.state.calls.filter((call) => call === 'fillRect')).toHaveLength(1);
    expect((styled.ctx as unknown as { lineWidth: number }).lineWidth).toBeCloseTo(layout!.fontSize * 0.18 * 2, 5);

    const plain = createStub();
    drawCaptions(plain.ctx, all, 2.5, 720, 1280, 'bold-pop');
    expect(plain.state.calls.filter((call) => call === 'fillRect')).toHaveLength(0);
  });
});
