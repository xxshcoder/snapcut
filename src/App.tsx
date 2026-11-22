import { useEffect, useRef, useState } from 'react';
import { FilePicker } from './components/FilePicker';
import { PreviewPane } from './components/PreviewPane';
import { ProgressCard } from './components/ProgressCard';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { UnsupportedNotice } from './components/UnsupportedNotice';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const state = useAppStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(state.objectUrl);
  const [projectName, setProjectName] = useState('Video-footage');
  const [playhead, setPlayhead] = useState(0);

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
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:flex-row">
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:flex-[1.75]">
                <div className="flex min-h-[280px] flex-1 flex-col md:min-h-0 md:flex-[1.6]">
                  {selectedClip && state.meta && state.objectUrl ? (
                    <PreviewPane
                      clip={selectedClip}
                      meta={state.meta}
                      objectUrl={state.objectUrl}
                      transcriptWords={state.transcript?.words ?? selectedClip.words}
                      onUpdate={(patch) => state.updateClip(selectedClip.id, patch)}
                      onTimeChange={setPlayhead}
                    />
                  ) : (
                    <div className="panel flex items-center justify-center text-sm muted">Select a clip to preview it.</div>
                  )}
                </div>

                {selectedClip && state.meta ? (
                  <div className="flex min-h-[180px] flex-1 flex-col md:min-h-0 md:flex-1">
                    <Timeline
                      clips={state.clips}
                      clip={selectedClip}
                      meta={state.meta}
                      playhead={playhead}
                      selectedIds={state.selectedClipIds}
                      onSelect={state.selectClip}
                      onToggle={state.toggleSelected}
                      onUpdate={(patch) => state.updateClip(selectedClip.id, patch)}
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
