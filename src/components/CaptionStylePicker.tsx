import type { CaptionStyleId } from '../types';

const STYLES: { id: CaptionStyleId; label: string; sample: string }[] = [
  { id: 'bold-pop', label: 'Bold pop', sample: 'Aa' },
  { id: 'minimal', label: 'Minimal', sample: 'Aa' },
  { id: 'karaoke', label: 'Karaoke', sample: 'Aa' },
];

type Props = {
  value: CaptionStyleId;
  onChange: (style: CaptionStyleId) => void;
};

export function CaptionStylePicker({ value, onChange }: Props) {
  return (
    <fieldset>
      <legend className="muted mb-2 text-xs font-semibold uppercase tracking-wide">Caption style</legend>
      <div className="grid grid-cols-3 gap-2">
        {STYLES.map((style) => (
          <label
            key={style.id}
            className={`flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-lg border p-2 text-xs ${
              value === style.id ? 'border-[var(--accent)] bg-[var(--surface-2)]' : 'border-[var(--border)]'
            }`}
          >
            <input
              type="radio"
              name="caption-style"
              className="sr-only"
              checked={value === style.id}
              onChange={() => onChange(style.id)}
            />
            <span
              className={`text-lg font-black ${style.id === 'minimal' ? 'font-normal' : ''} ${
                style.id === 'karaoke' ? 'text-[#ffd23f]' : ''
              }`}
            >
              {style.sample}
            </span>
            {style.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
