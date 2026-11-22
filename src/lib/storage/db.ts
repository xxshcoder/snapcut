import { openDB, type IDBPDatabase } from 'idb';
import { QuotaError } from '../errors';
import type { Clip, ProjectState, Transcript, Word } from '../../types';

const DB_NAME = 'snapcut';
const DB_VERSION = 1;

type SegmentRecord = {
  key: string;
  fileId: string;
  index: number;
  offsetSec: number;
  words: Word[];
  language?: string;
  durationSec: number;
};

export type SavedSegment = Omit<SegmentRecord, 'key' | 'fileId'>;

let dbPromise: Promise<IDBPDatabase | null> | null = null;
let unavailable = false;

async function getDb(): Promise<IDBPDatabase | null> {
  if (unavailable) return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('transcripts')) db.createObjectStore('transcripts', { keyPath: 'fileId' });
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'fileId' });
        if (!db.objectStoreNames.contains('segments')) db.createObjectStore('segments', { keyPath: 'key' });
      },
    }).catch(() => {
      unavailable = true;
      return null;
    });
  }
  return dbPromise;
}

async function write(store: 'transcripts' | 'projects' | 'segments', value: unknown): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.put(store, value);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new QuotaError();
    throw error;
  }
}

export async function saveTranscript(transcript: Transcript): Promise<void> {
  await write('transcripts', transcript);
}

export async function getTranscript(fileId: string): Promise<Transcript | undefined> {
  const db = await getDb();
  return db?.get('transcripts', fileId) as Promise<Transcript | undefined> | undefined;
}

export async function saveProject(project: ProjectState): Promise<void> {
  await write('projects', project);
}

export async function getProject(fileId: string): Promise<ProjectState | undefined> {
  const db = await getDb();
  return db?.get('projects', fileId) as Promise<ProjectState | undefined> | undefined;
}

export async function saveSegmentResult(fileId: string, segment: SavedSegment): Promise<void> {
  await write('segments', { ...segment, fileId, key: `${fileId}:${segment.index}` } satisfies SegmentRecord);
}

export async function getSegmentResults(fileId: string): Promise<SavedSegment[]> {
  const db = await getDb();
  if (!db) return [];
  const all = (await db.getAll('segments')) as SegmentRecord[];
  return all
    .filter((item) => item.fileId === fileId)
    .sort((a, b) => a.index - b.index)
    .map((item) => ({
      index: item.index,
      offsetSec: item.offsetSec,
      words: item.words,
      language: item.language,
      durationSec: item.durationSec,
    }));
}

export async function clearSegmentResults(fileId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const tx = db.transaction('segments', 'readwrite');
  const all = (await tx.store.getAll()) as SegmentRecord[];
  await Promise.all(all.filter((item) => item.fileId === fileId).map((item) => tx.store.delete(item.key)));
  await tx.done;
}

export function makeProject(fileId: string, name: string, durationSec: number, clips: Clip[]): ProjectState {
  return { fileId, name, durationSec, clips, updatedAt: Date.now() };
}
