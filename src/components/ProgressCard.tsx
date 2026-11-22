import type { Progress } from '../types';

type Props = {
  progress?: Progress;
  onCancel?: () => void;
};

export function ProgressCard({ progress, onCancel }: Props) {
  if (!progress) return null;
  const value = Math.max(0, Math.min(100, progress.percent));
  const eta = progress.etaSec
    ? `~${Math.max(1, Math.round(progress.etaSec))}s left`
    : `${progress.done}/${progress.total}`;
  return (
    <section className="panel p-4" aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-3">
        <strong className="text-sm">{progress.phase}</strong>
        <span className="muted text-xs">{eta}</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="muted text-xs">Keep this screen open while we work.</span>
        {onCancel ? (
          <button className="btn px-3 py-1 text-xs" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}
