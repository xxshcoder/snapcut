import type { Clip } from '../types';

type Props = {
  clips: Clip[];
  selectedId: string | null;
  selectedIds: string[];
  renderProgress: Record<string, { phase: string; percent: number }>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
};

function duration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Horizontal clip picker: keeps every clip reachable while the editor owns the main area. */
export function ClipList({ clips, selectedId, selectedIds, renderProgress, onSelect, onToggle }: Props) {
  return (
    <section aria-label="Suggested clips">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">Step 2 · Review</p>
          <h2 className="truncate text-sm font-bold">Suggested clips ({clips.length})</h2>
        </div>
        <span className="muted hidden text-xs sm:inline">Tap a clip to preview · tick to export</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {clips.map((clip, index) => {
          const progress = renderProgress[`render:${clip.id}`];
          const isActive = selectedId === clip.id;
          return (
            <li
              key={clip.id}
              className={`flex min-w-[210px] shrink-0 items-start gap-2 rounded-lg border p-2 ${
                isActive ? 'border-[var(--accent)] bg-[var(--surface-2)]' : 'border-[var(--border)]'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                checked={selectedIds.includes(clip.id)}
                onChange={() => onToggle(clip.id)}
                aria-label={`Export clip ${index + 1}`}
              />
              <button className="min-h-11 min-w-0 flex-1 text-left" onClick={() => onSelect(clip.id)}>
                <span className="block truncate text-sm font-semibold">{clip.title || `Clip ${index + 1}`}</span>
                <span className="muted mt-0.5 block text-xs">
                  {duration(clip.start)} → {duration(clip.end)} · {Math.round(clip.end - clip.start)}s ·{' '}
                  {clip.score}/100
                </span>
                {progress ? (
                  <span className="mt-1 block text-xs text-[var(--accent-2)]">
                    {progress.phase} {Math.round(progress.percent)}%
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
