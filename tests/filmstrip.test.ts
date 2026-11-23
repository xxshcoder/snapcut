import { describe, expect, it } from 'vitest';
import { filmstripTimestamps } from '../src/lib/track/filmstrip';

describe('filmstrip timestamps', () => {
  it('spans the requested range and stays frame aligned', () => {
    const times = filmstripTimestamps(1, 24, 24, 30);
    expect(times).toHaveLength(24);
    expect(times[0]).toBe(1);
    expect(times.at(-1)).toBe(24);
    for (const time of times) {
      expect(Math.abs(time * 30 - Math.round(time * 30))).toBeLessThan(1e-9);
    }
  });

  it('clamps thumbnail counts and keeps timestamps sorted', () => {
    expect(filmstripTimestamps(0, 10, 1)).toHaveLength(2);
    expect(filmstripTimestamps(0, 10, 999)).toHaveLength(48);
    const times = filmstripTimestamps(5, 15, 32, 30);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('never divides by zero for a zero-length range', () => {
    const times = filmstripTimestamps(4, 4, 8, 30);
    expect(times.every((time) => Number.isFinite(time))).toBe(true);
    expect(new Set(times).size).toBeGreaterThan(1);
  });
});
