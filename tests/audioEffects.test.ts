import { AudioSample } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { audioGainAt, hasAudioEffects, processAudioSample } from '../src/lib/render/audioEffects';
import type { Clip } from '../src/types';

const base: Clip = {
  id: 'clip-1',
  start: 0,
  end: 10,
  title: 'Title',
  hook: 'Hook',
  score: 80,
  crop: { mode: 'static', x: 0, y: 0, w: 0.3, h: 0.5 },
  captionsEnabled: true,
  captionStyle: 'bold-pop',
  words: [],
};

function sample(frames = 100, value = 0.5): AudioSample {
  return new AudioSample({
    data: new Float32Array(frames).fill(value),
    format: 'f32',
    numberOfChannels: 1,
    sampleRate: 48_000,
    timestamp: 0,
  });
}

function read(sampleToRead: AudioSample): Float32Array {
  const data = new Float32Array(sampleToRead.numberOfFrames * sampleToRead.numberOfChannels);
  sampleToRead.copyTo(data, { planeIndex: 0, format: 'f32' });
  return data;
}

describe('audio effects', () => {
  it('passes legacy clips through untouched', () => {
    expect(hasAudioEffects(base)).toBe(false);
    expect(audioGainAt(base, 3, 10)).toBe(1);
  });

  it('applies volume, mute and a linear output-timeline fade', () => {
    expect(audioGainAt({ ...base, volume: 0.5 }, 3, 10)).toBeCloseTo(0.5, 5);
    expect(audioGainAt({ ...base, muted: true, volume: 0.5 }, 3, 10)).toBe(0);
    expect(audioGainAt({ ...base, fadeInSec: 2 }, 1, 10)).toBeCloseTo(0.5, 5);
    expect(audioGainAt({ ...base, fadeInSec: 2 }, 5, 10)).toBe(1);
    expect(audioGainAt({ ...base, fadeOutSec: 2 }, 9, 10)).toBeCloseTo(0.5, 5);
    expect(audioGainAt({ ...base, fadeOutSec: 2 }, 7, 10)).toBe(1);
  });

  it('resamples frames and timestamps for speed', () => {
    const source = sample(100);
    const doubled = processAudioSample(source, { ...base, speed: 2 }, 0);
    expect(doubled.numberOfFrames).toBe(50);
    expect(doubled.timestamp).toBe(0);
    expect(read(doubled)[0]).toBeCloseTo(0.5, 5);

    const half = processAudioSample(source, { ...base, speed: 0.5 }, 2);
    expect(half.numberOfFrames).toBe(200);
    expect(half.timestamp).toBeCloseTo(4, 5);
    source.close();
    doubled.close();
    half.close();
  });

  it('scales gain into the processed samples', () => {
    const source = sample(10);
    const processed = processAudioSample(source, { ...base, volume: 0.25 }, 0);
    expect(read(processed)[5]).toBeCloseTo(0.125, 5);
    source.close();
    processed.close();
  });
});
