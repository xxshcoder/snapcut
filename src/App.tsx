import { useEffect, useRef } from 'react';
import { ClipEditor } from './components/ClipEditor';
import { ClipList } from './components/ClipList';
import { FilePicker } from './components/FilePicker';
import { InstallPrompt } from './components/InstallPrompt';
import { ProgressCard } from './components/ProgressCard';
import { UnsupportedNotice } from './components/UnsupportedNotice';
import { audioCodecLabel, useAppStore } from './store/useAppStore';

export default function App() {
  const state = useAppStore();
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // Keep the latest URL in a ref so the unmount cleanup never revokes an URL
  // that is still being displayed.
  const rootRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(state.objectUrl);
  useEffect(() => {
    objectUrlRef.current = state.objectUrl;
  }, [state.objectUrl]);

  useEffect(() => {
    state.initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    return () => {
      // StrictMode re-runs effects without removing the DOM; only revoke on a
      // real unmount, when the displayed node is gone.
      if (root?.isConnected) return;
      const url = objectUrlRef.current;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const { isAnalyzing, isRendering, flushSaves, handleVisibilityChange } = state;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (isAnalyzing || isRendering) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const flush = (): void => flushSaves();
    const visibility = (): void => handleVisibilityChange();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [isAnalyzing, isRendering, flushSaves, handleVisibilityChange]);

  const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId) ?? null;
  const selectedCount = state.selectedClipIds.length;
  const exportLabel = selectedCount === 0
    ? 'Select clips to export'
    : selectedCount === 1
      ? 'Export 1 clip'
      : `Export ${selectedCount} clips`;
  const renderProgress = Object.fromEntries(
    Object.entries(state.progress)
      .filter(([key]) => key.startsWith('render:'))
      .map(([key, value]) => [key, { phase: value.phase, percent: value.percent }]),
  );

  return (
    <div ref={rootRef} className="min-h-screen bg-[var(--bg)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-3 py-3 sm:px-5">
          <div className="text-2xl" aria-hidden="true">✂️</div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-black leading-tight">Snapcut</h1>
            <p className="muted hidden text-xs sm:block">Private clips, made in your browser</p>
          </div>
          <span className="hidden rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--accent-2)] sm:inline">
            Video stays on your device
          </span>
          <InstallPrompt />
          <button
            className="btn h-11 w-11 shrink-0 px-0 text-base"
            onClick={() => state.setTheme(state.theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            title={state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {state.theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 px-3 py-4 sm:px-5">
        <UnsupportedNotice caps={state.caps} />

        {state.error ? (
          <div className="panel border-[var(--danger)] p-3 text-sm" role="alert">
            <strong>{state.error.message}</strong>
            {state.error.action ? <p className="muted mt-1">{state.error.action}</p> : null}
            <button className="btn mt-2 px-3 py-1 text-xs" onClick={state.dismissError}>Dismiss</button>
          </div>
        ) : null}

        {state.notice ? (
          <div className="panel border-[var(--accent-2)] p-3 text-sm" role="status">
            <span>{state.notice}</span>
            <button className="btn ml-3 px-3 py-1 text-xs" onClick={state.dismissNotice}>Dismiss</button>
          </div>
        ) : null}

        {!state.file ? (
          <FilePicker disabled={state.isAnalyzing} isMobile={state.caps?.isMobile ?? false} onFile={(file) => void state.setFile(file)} />
        ) : (
          <>
            <div className="panel flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{state.file.name}</p>
                <p className="muted text-xs">
                  {(state.file.size / 1e9).toFixed(2)} GB
                  {audioCodecLabel(state.audioCodec) ? ` · Audio: ${audioCodecLabel(state.audioCodec)}` : ''}
                  {state.meta ? ` · ${Math.round(state.meta.durationSec / 60)} min · ${state.meta.width}×${state.meta.height}` : ''}
                </p>
              </div>
              {state.cachedResult ? <span className="text-xs text-[var(--accent-2)]">Cached transcript</span> : null}
              <input
                ref={replaceInputRef}
                type="file"
                accept="video/*"
                aria-label="Replace video file"
                aria-hidden="true"
                className="sr-only"
                tabIndex={-1}
                disabled={state.isAnalyzing || state.isRendering}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void state.setFile(file);
                  event.target.value = '';
                }}
              />
              <button
                className="btn px-3 py-1 text-xs"
                disabled={state.isAnalyzing || state.isRendering}
                onClick={() => replaceInputRef.current?.click()}
              >
                Replace video
              </button>
              {state.clips.length > 0 ? (
                <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">
                    Step 3 · Export
                  </span>
                  <div className="flex gap-2">
                    {state.isRendering ? (
                      <button className="btn" onClick={state.cancelRender}>Cancel</button>
                    ) : null}
                    <button
                      className="btn btn-primary min-w-36"
                      disabled={state.isRendering || selectedCount === 0}
                      onClick={() => void state.renderSelected()}
                    >
                      {state.isRendering ? 'Exporting…' : exportLabel}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {state.isAnalyzing ? (
              <ProgressCard progress={state.progress.analysis} onCancel={state.cancelAnalysis} />
            ) : null}

            {state.clips.length > 0 ? (
              <>
                <div className="panel p-3">
                  <ClipList
                    clips={state.clips}
                    selectedId={state.selectedClipId}
                    selectedIds={state.selectedClipIds}
                    renderProgress={renderProgress}
                    onSelect={state.selectClip}
                    onToggle={state.toggleSelected}
                  />
                  <p className="muted mt-2 text-xs">
                    One clip at a time. Output is 9:16 MP4; iOS uses Share, others download.
                  </p>
                </div>

                {selectedClip && state.meta && state.objectUrl ? (
                  <ClipEditor
                    clip={selectedClip}
                    meta={state.meta}
                    objectUrl={state.objectUrl}
                    transcriptWords={state.transcript?.words ?? selectedClip.words}
                    trackProgress={state.progress[`track:${selectedClip.id}`]}
                    onUpdate={(patch) => state.updateClip(selectedClip.id, patch)}
                    onWordChange={(index, text) => state.updateWord(selectedClip.id, index, text)}
                    onTrack={() => void state.trackClip(selectedClip.id)}
                  />
                ) : (
                  <div className="panel p-6 text-center text-sm">Select a clip to edit it.</div>
                )}
              </>
            ) : null}

            {state.rendered.length > 0 ? (
              <section className="panel p-3">
                <h2 className="text-sm font-bold">Exported clips</h2>
                <ul className="muted mt-2 space-y-1 text-xs">
                  {state.rendered.map((item) => (
                    <li key={item.clipId}>
                      {item.filename} · {item.width}×{item.height} · {item.usedCodec}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

          </>
        )}
      </main>
    </div>
  );
}
