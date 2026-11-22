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

export function ClipList({ clips, selectedId, selectedIds, renderProgress, onSelect, onToggle }: Props) {
  return (
    <section className="panel overflow-hidden" aria-label="Suggested clips">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <h2 className="text-sm font-bold">Suggested clips ({clips.length})</h2>
        <span className="muted text-xs">Tap to preview</span>
      </header>
      <ul className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto lg:max-h-[calc(100vh-15rem)]">
        {clips.map((clip, index) => {
          const progress = renderProgress[`render:${clip.id}`];
          return (
            <li key={clip.id} className={selectedId === clip.id ? 'bg-[var(--surface-2)]' : ''}>
              <div className="flex items-start gap-2 p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                  checked={selectedIds.includes(clip.id)}
                  onChange={() => onToggle(clip.id)}
                  aria-label={`Export clip ${index + 1}`}
                />
                <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(clip.id)}>
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
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
