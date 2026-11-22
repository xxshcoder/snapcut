import { useRef, useState, type DragEvent } from 'react';
import { Icon } from './Icon';
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
      className={`panel flex w-full max-w-xl flex-col items-center justify-center gap-4 border-2 border-dashed p-8 text-center ${
        dragging ? 'border-[var(--accent)]' : 'border-[#4a5078]'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      aria-label="Choose a video file"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--chip)] text-[var(--accent)]">
        <Icon name="tray" size={32} />
      </div>
      <h2 className="text-xl font-bold">Pick a video to clip</h2>
      <p className="muted max-w-md text-sm">
        Your video stays on this device. Only compressed audio and transcript text are sent for analysis.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        aria-label="Choose a video file"
        aria-hidden="true"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <button className="btn btn-primary px-6" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <Icon name="upload" size={18} />
        Choose video
      </button>
      <p className="muted text-xs">
        Up to {(limits.maxBytes / 1e9).toFixed(0)} GB / {Math.round(limits.maxDurationSec / 60)} min on{' '}
        {isMobile ? 'phone' : 'desktop'}
      </p>
    </section>
  );
}
