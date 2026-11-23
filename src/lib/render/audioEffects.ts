import { AudioSample } from 'mediabunny';
import type { Clip } from '../../types';
import { clipFade, clipOutputDuration, clipSpeed, clipVolume } from './clipOptions';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Gain envelope on the *output* timeline, after speed has been applied. */
export function audioGainAt(clip: Clip, outputTimeSec: number, outputDurationSec: number): number {
  if (clip.muted) return 0;
  let gain = clipVolume(clip);
  const fadeIn = clipFade(clip, 'fadeInSec');
  const fadeOut = clipFade(clip, 'fadeOutSec');
  if (fadeIn > 0 && outputTimeSec < fadeIn) gain *= clamp(outputTimeSec / fadeIn, 0, 1);
  if (fadeOut > 0 && outputTimeSec > outputDurationSec - fadeOut) {
    gain *= clamp((outputDurationSec - outputTimeSec) / fadeOut, 0, 1);
  }
  return gain;
}

export function hasAudioEffects(clip: Clip): boolean {
  return (
    clipSpeed(clip) !== 1 ||
    clipVolume(clip) !== 1 ||
    clip.muted === true ||
    clipFade(clip, 'fadeInSec') > 0 ||
    clipFade(clip, 'fadeOutSec') > 0
  );
}

/**
 * Re-time and gain a decoded source sample onto the output timeline.
 *
 * Mediabunny's `AudioSampleSource` still resamples/remixes to 48 kHz stereo
 * after this, so it is safe to keep the source rate and channel layout here.
 * Output timestamps are `sourceTime / speed`, which keeps the stream
 * continuous for every speed in the supported 0.5–2× range.
 */
export function processAudioSample(sample: AudioSample, clip: Clip, sourceRelativeSec: number): AudioSample {
  const rate = sample.sampleRate;
  const channels = sample.numberOfChannels;
  const frames = sample.numberOfFrames;
  const speed = clipSpeed(clip);
  const duration = clipOutputDuration(clip);
  const outFrames = Math.max(1, Math.round(frames / speed));

  const source = new Float32Array(frames * channels);
  sample.copyTo(source, { planeIndex: 0, format: 'f32' });

  const output = new Float32Array(outFrames * channels);
  const startTimestamp = sourceRelativeSec / speed;
  for (let i = 0; i < outFrames; i++) {
    const position = frames <= 1 ? 0 : Math.min(frames - 1, i * speed);
    const left = Math.floor(position);
    const right = Math.min(frames - 1, left + 1);
    const mix = position - left;
    const gain = audioGainAt(clip, startTimestamp + i / rate, duration);
    for (let channel = 0; channel < channels; channel++) {
      const a = source[left * channels + channel] ?? 0;
      const b = source[right * channels + channel] ?? a;
      output[i * channels + channel] = (a + (b - a) * mix) * gain;
    }
  }

  return new AudioSample({
    data: output,
    format: 'f32',
    numberOfChannels: channels,
    sampleRate: rate,
    timestamp: startTimestamp,
  });
}
