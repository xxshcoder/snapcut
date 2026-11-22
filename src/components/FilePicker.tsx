import { useRef, useState, type DragEvent } from 'react';
import { LIMITS } from '../config';

type Props = {
  disabled: boolean;
  isMobile: boolean;
  onFile: (file: File) => void;
};

export function FilePicker({ disabled, isMobile, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const limits = isMobile ? LIMITS.phone : LIMITS.desktop;

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <section
      className={`panel flex min-h-64 flex-col items-center justify-center gap-3 border-2 border-dashed p-5 text-center ${
        dragging ? 'border-[var(--accent)]' : 'border-[var(--border)]'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      aria-label="Choose a video file"
    >
      <div className="text-4xl" aria-hidden="true">🎬</div>
      <h2 className="text-xl font-bold">Pick a video to clip</h2>
      <p className="muted max-w-md text-sm">
        Your video stays on this device. Only compressed audio and transcript text are sent for analysis.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        aria-label="Choose a video file"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <button className="btn btn-primary" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose video
      </button>
      <p className="muted text-xs">
        Up to {(limits.maxBytes / 1e9).toFixed(0)} GB / {Math.round(limits.maxDurationSec / 60)} min on{' '}
        {isMobile ? 'phone' : 'desktop'}
      </p>
    </section>
  );
}
