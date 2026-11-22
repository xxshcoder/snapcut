export type ExportResult = 'shared' | 'downloaded';

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportBlob(blob: Blob, filename: string, preferShare: boolean): Promise<ExportResult> {
  if (preferShare && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'downloaded';
      // Fall through to download.
    }
  }
  download(blob, filename);
  return 'downloaded';
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'clip';
}

export async function exportAll(
  clips: { blob: Blob; filename: string }[],
  preferShare: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (const [index, clip] of clips.entries()) {
    await exportBlob(clip.blob, clip.filename, preferShare);
    onProgress?.(index + 1, clips.length);
  }
}
