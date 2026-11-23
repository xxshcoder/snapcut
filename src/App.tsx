import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePicker } from './components/FilePicker';
import { PreviewPane } from './components/PreviewPane';
import { ProgressCard } from './components/ProgressCard';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { UnsupportedNotice } from './components/UnsupportedNotice';
import { LIMITS, RENDER } from './config';
import { isEditableTarget } from './lib/keyboard';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const state = useAppStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(state.objectUrl);
  const [projectName, setProjectName] = useState('Video-footage');
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const seekVideoRef = useRef<((time: number) => void) | null>(null);
  const registerSeek = useCallback((fn: ((time: number) => void) | null): void => {
    seekVideoRef.current = fn;
  }, []);

  useEffect(() => {
    objectUrlRef.current = state.objectUrl;
  }, [state.objectUrl]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    state.initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    return () => {
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

  // Editing shortcuts are global; they are ignored while the user is typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      const store = useAppStore.getState();
      if (store.isAnalyzing || store.isRendering) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      const id = store.selectedClipId;
      const clip = store.clips.find((item) => item.id === id);
      const round = (value: number): number => Math.round(value * RENDER.frameRate) / RENDER.frameRate;

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }
      if (!id || !clip) return;

      if (mod && key === 'd') {
        event.preventDefault();
        store.duplicateClip(id);
      } else if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        store.deleteClip(id);
      } else if (!mod && (key === 's' || key === 'x')) {
        event.preventDefault();
        // Frame-accurate cut: always land exactly on the displayed frame boundary.
        const frame = Math.round(playheadRef.current * RENDER.frameRate);
        store.splitClip(id, frame / RENDER.frameRate);
      } else if (!mod && key === 'i') {
        event.preventDefault();
        const at = round(Math.min(Math.max(0, clip.end - LIMITS.minClipSec), Math.max(0, playheadRef.current)));
        if (at > clip.start + 0.1) store.updateClip(id, { start: at });
      } else if (!mod && key === 'o') {
        event.preventDefault();
        const max = store.meta?.durationSec ?? clip.end;
        const at = round(Math.min(max, Math.max(clip.start + LIMITS.minClipSec, playheadRef.current)));
        if (at < clip.end - 0.1) store.updateClip(id, { end: at });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId) ?? null;
  const cutAtFrame = (): void => {
    if (!selectedClip) return;
    const frame = Math.round(playhead * RENDER.frameRate);
    state.splitClip(selectedClip.id, frame / RENDER.frameRate);
  };
  const selectedCount = state.selectedClipIds.length;
  // Unticking clips never blocks export: the active clip (or all clips) is used.
  const exportCount = selectedCount > 0 ? selectedCount : selectedClip ? 1 : state.clips.length;
  const exportLabel = exportCount === 1 ? 'Export 1 clip' : `Export ${exportCount} clips`;

  return (
    <div ref={rootRef} className="h-[100dvh] w-full overflow-hidden">
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--window)]">
        <TopBar
          projectName={projectName}
          hasProject={Boolean(state.file)}
          onProjectNameChange={setProjectName}
          onExport={() => void state.renderSelected()}
          exportLabel={exportLabel}
          isExporting={isRendering}
          canExport={!isRendering && exportCount > 0}
          canUndo={!isRendering && !isAnalyzing && state.past.length > 0}
          canRedo={!isRendering && !isAnalyzing && state.future.length > 0}
          onUndo={state.undo}
          onRedo={state.redo}
          onCancel={state.cancelRender}
          theme={state.theme}
          onToggleTheme={() => state.setTheme(state.theme === 'dark' ? 'light' : 'dark')}
        />

        {/* Notices float above the editor and never take layout space. */}
        {state.error || state.notice ? (
          <div className="pointer-events-none absolute right-4 top-20 z-40 flex w-[min(360px,calc(100%-2rem))] flex-col gap-2 sm:right-6">
            {state.error ? (
              <div className="panel pointer-events-auto border border-[var(--danger)] p-3 text-sm shadow-2xl" role="alert">
                <strong>{state.error.message}</strong>
                {state.error.action ? <p className="muted mt-1">{state.error.action}</p> : null}
                <button className="btn mt-2 px-3 py-1 text-xs" onClick={state.dismissError}>Dismiss</button>
              </div>
            ) : null}
            {state.notice ? (
              <div className="panel pointer-events-auto flex items-start gap-2 border border-[var(--accent)] p-3 text-sm shadow-2xl" role="status">
                <span className="flex-1">{state.notice}</span>
                <button className="btn shrink-0 px-3 py-1 text-xs" onClick={state.dismissNotice}>Dismiss</button>
              </div>
            ) : null}
          </div>
        ) : null}

        <main className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-2 sm:p-2.5 max-md:overflow-y-auto">
          <UnsupportedNotice caps={state.caps} />

          {state.isAnalyzing ? (
            <div className="shrink-0">
              <ProgressCard progress={state.progress.analysis} onCancel={state.cancelAnalysis} />
            </div>
          ) : null}

          {!state.file ? (
            <div className="flex min-h-[300px] flex-1 items-center justify-center max-md:min-h-[420px]">
              <FilePicker
                disabled={state.isAnalyzing}
                isMobile={state.caps?.isMobile ?? false}
                onFile={(file) => {
                  setProjectName(file.name);
                  void state.setFile(file);
                }}
              />
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 md:flex-row">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 md:flex-[1.75]">
                <div className="flex min-h-[280px] min-w-0 flex-1 flex-col md:min-h-0 md:flex-[1.6]">
                  {selectedClip && state.meta && state.objectUrl ? (
                    <PreviewPane
                      clip={selectedClip}
                      meta={state.meta}
                      objectUrl={state.objectUrl}
                      transcriptWords={state.transcript?.words ?? selectedClip.words}
                      onUpdate={(patch) => state.updateClip(selectedClip.id, patch)}
                      onTimeChange={setPlayhead}
                      registerSeek={registerSeek}
                      onCutAtFrame={cutAtFrame}
                      canCut={playhead > selectedClip.start && playhead < selectedClip.end}
                    />
                  ) : (
                    <div className="panel flex items-center justify-center text-sm muted">Select a clip to preview it.</div>
                  )}
                </div>

                {selectedClip && state.meta ? (
                  <div className="flex min-h-[180px] min-w-0 flex-1 flex-col md:min-h-0 md:flex-1">
                    <Timeline
                      clips={state.clips}
                      clip={selectedClip}
                      meta={state.meta}
                      playhead={playhead}
                      selectedIds={state.selectedClipIds}
                      filmstrip={state.filmstrip}
                      onSelect={state.selectClip}
                      onToggle={state.toggleSelected}
                      onUpdate={(patch) => state.updateClip(selectedClip.id, patch)}
                      onSplit={() => state.splitClip(selectedClip.id, playhead)}
                      onDuplicate={() => state.duplicateClip(selectedClip.id)}
                      onDelete={() => state.deleteClip(selectedClip.id)}
                      onRemoveSilences={() => state.removeSilences(selectedClip.id)}
                      onSeek={(time: number) => {
                        const at = Math.round(time * RENDER.frameRate) / RENDER.frameRate;
                        setPlayhead(at);
                        seekVideoRef.current?.(at);
                      }}
                    />
                  </div>
                ) : null}

                {state.rendered.length > 0 ? (
                  <div className="panel shrink-0 px-4 py-2 text-xs">
                    <span className="font-semibold">Exported:</span>{' '}
                    {state.rendered.map((item) => `${item.width}×${item.height} · ${item.usedCodec}`).join(', ')}
                  </div>
                ) : null}
              </div>

              <div className="flex min-h-[300px] flex-1 flex-col md:min-h-0 md:w-[280px] md:flex-none xl:w-[320px]">
                {selectedClip && state.meta ? (
                  <PropertiesPanel
                    clip={selectedClip}
                    meta={state.meta}
                    transcriptWords={state.transcript?.words ?? selectedClip.words}
                    trackProgress={state.progress[`track:${selectedClip.id}`]}
                    onUpdate={(patch) => state.updateClip(selectedClip.id, patch)}
                    onWordChange={(index, text) => state.updateWord(selectedClip.id, index, text)}
                    onTrack={() => void state.trackClip(selectedClip.id)}
                  />
                ) : (
                  <div className="panel flex items-center justify-center p-6 text-center text-sm muted">
                    Clip settings appear here.
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
