import {
  AudioSampleSink,
  AudioSampleSource,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  StreamTarget,
} from 'mediabunny';
import { AUDIO } from '../../config';
import { CancelledError, NoAudioTrackError, UnsupportedCodecError } from '../errors';
import { writeChunkAt } from '../storage/opfs';
import type { OutputChunk } from '../storage/opfs';
import type { AudioSegment, SegmentPlan } from '../../types';
import { planAudioSegments } from './segment';

export type AudioCodec = 'opus' | 'aac';
export type ExtractResult = { segments: AudioSegment[]; codec: AudioCodec; durationSec: number };

export type ExtractOptions = {
  signal?: AbortSignal;
  onProgress?: (doneSec: number, totalSec: number) => void;
  /** Called as soon as the encoder is chosen so callers can surface the codec early. */
  onCodec?: (codec: AudioCodec) => void;
};

async function codecSupported(codec: AudioCodec): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  const config: AudioEncoderConfig =
    codec === 'opus'
      ? { codec: 'opus', sampleRate: AUDIO.sampleRate, numberOfChannels: AUDIO.channels, bitrate: AUDIO.opusBitrate }
      : {
          codec: 'mp4a.40.2',
          sampleRate: AUDIO.aacSampleRate,
          numberOfChannels: AUDIO.channels,
          bitrate: AUDIO.aacBitrate,
        };
  try {
    return (await AudioEncoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

function newFormat(codec: AudioCodec) {
  return codec === 'opus' ? new OggOutputFormat() : new Mp4OutputFormat();
}

/** Decode one time range and stream-encode it; at most a few chunks are held in RAM. */
async function encodeSegment(
  sink: AudioSampleSink,
  plan: SegmentPlan,
  codec: AudioCodec,
  signal?: AbortSignal,
  onProgress?: (doneSec: number) => void,
): Promise<Blob> {
  const chunks: OutputChunk[] = [];
  const writable = new WritableStream<OutputChunk>({
    write(chunk) {
      chunks.push({ data: chunk.data.slice(), position: chunk.position });
    },
  });
  const output = new Output({ format: newFormat(codec), target: new StreamTarget(writable, { chunked: true, chunkSize: 1 << 16 }) });
  const source = new AudioSampleSource({
    codec,
    quality: new Quality({ bitrate: codec === 'opus' ? AUDIO.opusBitrate : AUDIO.aacBitrate }),
    transform: {
      numberOfChannels: AUDIO.channels,
      sampleRate: codec === 'opus' ? AUDIO.sampleRate : AUDIO.aacSampleRate,
    },
  });
  output.addAudioTrack(source);
  await output.start();

  const iterator = sink.samples(plan.offsetSec, plan.offsetSec + plan.durationSec);
  try {
    for await (const sample of iterator) {
      if (signal?.aborted) throw new CancelledError();
      // Segment audio must start at timestamp 0 for the transcription API.
      const relative = Math.max(0, sample.timestamp - plan.offsetSec);
      sample.setTimestamp(relative);
      await source.add(sample);
      const progress = Math.min(plan.durationSec, relative + sample.duration);
      sample.close();
      onProgress?.(progress);
    }
  } finally {
    await iterator.return?.();
  }
  source.close();

  if (signal?.aborted) {
    await output.cancel();
    throw new CancelledError();
  }
  await output.finalize();

  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  for (const chunk of chunks) bytes = writeChunkAt(bytes, chunk.position, chunk.data);
  return new Blob([bytes], { type: codec === 'opus' ? 'audio/ogg' : 'audio/mp4' });
}

/** Stream-decode the source audio into <= 5 MB 16 kHz mono segments. */
export async function extractAudio(
  file: File,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const { createInput } = await import('../fileSource');
  const input = createInput(file);
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack || !(await audioTrack.canDecode())) throw new NoAudioTrackError();
    const codec: AudioCodec = (await codecSupported('opus')) ? 'opus' : (await codecSupported('aac')) ? 'aac' : (() => {
      throw new UnsupportedCodecError('Opus/AAC audio encoder');
    })();
    options.onCodec?.(codec);
    const durationSec = await audioTrack.computeDuration();
    const plans = planAudioSegments(durationSec, {
      bytesPerSecond:
        (codec === 'opus' ? AUDIO.opusBitrate : AUDIO.aacBitrate) / 8 * 1.15 + 1024,
    });
    const sink = new AudioSampleSink(audioTrack);
    const segments: AudioSegment[] = [];
    let doneSec = 0;

    for (const plan of plans) {
      const blob = await encodeSegment(sink, plan, codec, options.signal, (partial) => {
        options.onProgress?.(doneSec + partial, durationSec);
      });
      doneSec += plan.durationSec;
      options.onProgress?.(doneSec, durationSec);
      segments.push({
        index: plan.index,
        offsetSec: plan.offsetSec,
        durationSec: plan.durationSec,
        blob,
        mime: codec === 'opus' ? 'audio/ogg' : 'audio/mp4',
      });
    }
    return { segments, codec, durationSec };
  } finally {
    input.dispose();
  }
}
