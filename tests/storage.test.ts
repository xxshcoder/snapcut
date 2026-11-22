import { describe, expect, it } from 'vitest';
import {
  clearSegmentResults,
  getProject,
  getSegmentResults,
  getTranscript,
  makeProject,
  saveProject,
  saveSegmentResult,
  saveTranscript,
} from '../src/lib/storage/db';
import type { Clip, Transcript, Word } from '../src/types';

const clip: Clip = {
  id: 'clip-1',
  start: 5,
  end: 30,
  title: 'Opening hook',
  hook: 'This is the hook.',
  score: 82,
  crop: { mode: 'static', x: 0.1, y: 0, w: 0.3, h: 0.5 },
  captionsEnabled: true,
  captionStyle: 'karaoke',
  words: [{ text: 'This', start: 5, end: 5.4 }],
};

const word = (text: string, start: number, end: number): Word => ({ text, start, end });

describe('IndexedDB storage (fake-indexeddb)', () => {
  it('saves and loads a transcript by FileId, including overwrites', async () => {
    const transcript: Transcript = {
      fileId: 'file-transcript-1',
      language: 'en',
      words: [word('Hello', 0, 0.5), word('world.', 0.5, 1.2)],
      durationSec: 120,
    };

    await saveTranscript(transcript);
    expect(await getTranscript('file-transcript-1')).toEqual(transcript);

    const updated: Transcript = { ...transcript, words: [word('Changed', 0, 1)] };
    await saveTranscript(updated);
    expect(await getTranscript('file-transcript-1')).toEqual(updated);
    expect(await getTranscript('file-transcript-missing')).toBeUndefined();
  });

  it('saves and loads a project with edited clips', async () => {
    const project = makeProject('file-project-1', 'talk.mp4', 120, [clip]);

    expect(project).toMatchObject({ fileId: 'file-project-1', name: 'talk.mp4', durationSec: 120 });
    expect(project.updatedAt).toBeTypeOf('number');

    await saveProject(project);
    expect(await getProject('file-project-1')).toEqual(project);
    expect(await getProject('file-project-missing')).toBeUndefined();
  });

  it('stores segment results per file, sorted by index, and clears only that file', async () => {
    await saveSegmentResult('file-segments-1', {
      index: 1,
      offsetSec: 600,
      durationSec: 300,
      language: 'en',
      words: [word('Later', 0, 0.7)],
    });
    await saveSegmentResult('file-segments-1', {
      index: 0,
      offsetSec: 0,
      durationSec: 600,
      words: [word('First', 0, 0.7)],
    });
    await saveSegmentResult('file-segments-other', {
      index: 0,
      offsetSec: 0,
      durationSec: 10,
      words: [word('Other', 0, 1)],
    });

    const results = await getSegmentResults('file-segments-1');
    expect(results.map((item) => item.index)).toEqual([0, 1]);
    expect(results.map((item) => item.offsetSec)).toEqual([0, 600]);
    expect(results[0]?.words).toEqual([word('First', 0, 0.7)]);
    expect(results.every((item) => !('key' in item))).toBe(true);
    expect(await getSegmentResults('file-segments-missing')).toEqual([]);

    await clearSegmentResults('file-segments-1');
    expect(await getSegmentResults('file-segments-1')).toEqual([]);
    expect(await getSegmentResults('file-segments-other')).toHaveLength(1);
  });
});
