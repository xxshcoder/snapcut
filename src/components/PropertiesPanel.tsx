import { useState, type ReactNode } from 'react';
import { CaptionStylePicker } from './CaptionStylePicker';
import { Icon } from './Icon';
import { LIMITS } from '../config';
import { centeredCrop } from '../lib/render/crop';
import { audioCodecLabel } from '../store/useAppStore';
import type { CaptionStyleId, Clip, FileMeta, Progress, Word } from '../types';

type Props = {
  clip: Clip;
  meta: FileMeta;
  transcriptWords: Word[];
  trackProgress?: Progress;
  onUpdate: (patch: Partial<Clip>) => void;
  onWordChange: (index: number, text: string) => void;
  onTrack: () => void;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--divider)] bg-white/[0.02] p-3">
      <h3 className="muted mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[58px_1fr] items-center gap-2">
      <span className="muted text-xs">{label}</span>
      {children}
    </div>
  );
}

function SecondsInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        className="field w-full py-1.5 pr-7 text-sm tabular-nums"
        min={0}
        max={max}
        step={0.1}
        value={Number(value.toFixed(1))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="muted pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs">s</span>
    </label>
  );
}

export function PropertiesPanel({ clip, meta, transcriptWords, trackProgress, onUpdate, onWordChange, onTrack }: Props) {
  const [tab, setTab] = useState<'properties' | 'info'>('properties');
  const [showWords, setShowWords] = useState(false);
  const duration = Math.max(0, clip.end - clip.start);
  const isTracked = clip.crop.mode === 'tracked';

  const setStart = (value: number): void => {
    onUpdate({ start: Math.max(0, Math.min(value, clip.end - LIMITS.minClipSec)) });
  };
  const setEnd = (value: number): void => {
    onUpdate({ end: Math.min(meta.durationSec, Math.max(value, clip.start + LIMITS.minClipSec)) });
  };
  const centerCrop = (): void => {
    onUpdate({ crop: { mode: 'static', ...centeredCrop(meta.width, meta.height) } });
  };

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden" aria-label="Properties panel">
      {/* Tabs */}
      <div className="flex shrink-0 border-b border-[var(--divider)] bg-black/20">
        {(['properties', 'info'] as const).map((id) => (
          <button
            key={id}
            className={`relative flex-1 py-3 text-sm font-bold capitalize ${tab === id ? 'text-white' : 'muted'}`}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            {id}
            {tab === id ? <span className="absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 bg-white" /> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'info' ? (
          <Group title="Clip info">
            <div className="space-y-2 text-sm">
              {[
                ['Source', meta.name],
                ['Resolution', `${meta.width}×${meta.height}`],
                ['Duration', `${Math.round(meta.durationSec)}s`],
                ['Audio', audioCodecLabel(meta.audioCodec) ?? 'None'],
                ['Range', `${clip.start.toFixed(1)}s → ${clip.end.toFixed(1)}s`],
                ['Score', `${clip.score}/100`],
              ].map(([label, value]) => (
                <div key={label} className="chip flex items-center justify-between gap-2 p-2">
                  <span className="muted">{label}</span>
                  <span className="truncate text-right font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </Group>
        ) : (
          <>
            {/* Timing — every value here directly changes the exported range. */}
            <Group title="Timing">
              <div className="space-y-2.5">
                <Row label="Start">
                  <SecondsInput label="Clip start" value={clip.start} max={clip.end} onChange={setStart} />
                </Row>
                <Row label="End">
                  <SecondsInput label="Clip end" value={clip.end} max={meta.durationSec} onChange={setEnd} />
                </Row>
                <Row label="Length">
                  <div className="chip px-3 py-1.5 text-sm font-semibold tabular-nums">{duration.toFixed(1)} s</div>
                </Row>
              </div>
            </Group>

            {/* Captions — toggle and style feed the renderer. */}
            <Group title="Captions">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={clip.captionsEnabled}
                    onChange={(event) => onUpdate({ captionsEnabled: event.target.checked })}
                  />
                  Burn in captions
                </label>
                <CaptionStylePicker
                  value={clip.captionStyle}
                  onChange={(style: CaptionStyleId) => onUpdate({ captionStyle: style })}
                />
              </div>
            </Group>

            {/* Framing — the crop box is dragged in the preview; these buttons act on it. */}
            <Group title="Framing">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="muted">Mode</span>
                  <span className="chip px-2 py-0.5 font-semibold">{isTracked ? 'Auto-follow' : 'Manual 9:16'}</span>
                </div>
                <p className="muted text-[11px] leading-snug">
                  Drag the crop box in the preview to reframe. Scroll or pinch to zoom.
                </p>
                <button className="btn w-full px-3 text-xs" onClick={centerCrop}>
                  <Icon name="crop" size={15} />
                  Center crop
                </button>
              </div>
            </Group>

            {/* Clip details — title and hook persist with the project. */}
            <Group title="Clip details">
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold">
                  Title
                  <input
                    className="field mt-1 text-sm font-normal"
                    value={clip.title}
                    maxLength={80}
                    onChange={(event) => onUpdate({ title: event.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold">
                  Hook
                  <textarea
                    className="field mt-1 resize-none text-sm font-normal"
                    rows={2}
                    value={clip.hook}
                    maxLength={300}
                    onChange={(event) => onUpdate({ hook: event.target.value })}
                  />
                </label>
              </div>
            </Group>

            {showWords ? (
              <Group title="Caption words">
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {transcriptWords.map((word, index) => (
                    <label key={`${word.start}-${index}`} className="flex items-center gap-2 text-xs">
                      <span className="muted w-9 shrink-0 tabular-nums">{word.start.toFixed(1)}s</span>
                      <input
                        className="field min-w-0 text-sm"
                        value={word.text}
                        onChange={(event) => onWordChange(index, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </Group>
            ) : null}
          </>
        )}
      </div>

      {/* Sticky action bar: the two primary actions stay visible and aligned. */}
      {tab === 'properties' ? (
        <div className="shrink-0 space-y-2 border-t border-[var(--divider)] bg-black/20 p-3">
          {trackProgress ? <p className="muted text-center text-xs">{trackProgress.phase} {trackProgress.percent}%</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn px-2 text-xs" onClick={onTrack} disabled={trackProgress !== undefined}>
              <Icon name="sliders" size={15} />
              <span className="truncate">Auto-follow</span>
            </button>
            <button className="btn px-2 text-xs" onClick={() => setShowWords(!showWords)} aria-expanded={showWords}>
              <Icon name="text" size={15} />
              <span className="truncate">{showWords ? 'Hide words' : `Edit words (${clip.words.length})`}</span>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
