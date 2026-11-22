import type { Capabilities } from '../types';

export function UnsupportedNotice({ caps }: { caps: Capabilities | null }) {
  if (!caps || caps.missing.length === 0) return null;
  return (
    <section className="panel border-[var(--danger)] p-3 text-sm" role="status">
      <strong>Some features are unavailable in this browser.</strong>
      <p className="muted mt-1">
        Missing {caps.missing.join(', ')}. Try the latest Chrome or Edge. Desktop Firefox can use the ffmpeg
        fallback for export.
      </p>
    </section>
  );
}
