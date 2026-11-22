import { useState, type FocusEvent } from 'react';
import { Icon } from './Icon';
import { InstallPrompt } from './InstallPrompt';

type Props = {
  projectName: string;
  hasProject: boolean;
  onProjectNameChange: (name: string) => void;
  onExport: () => void;
  exportLabel: string;
  isExporting: boolean;
  canExport: boolean;
  onCancel: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
};

export function TopBar({
  projectName,
  hasProject,
  onProjectNameChange,
  onExport,
  exportLabel,
  isExporting,
  canExport,
  onCancel,
  theme,
  onToggleTheme,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
  };

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-[var(--divider)] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent)] px-5 py-2 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-lg font-black text-white"
          aria-hidden="true"
        >
          S
        </div>
        <span className="font-script hidden text-2xl leading-none text-white sm:inline">Snapcut</span>
      </div>

      {/* The title only belongs to a loaded project; on the picker screen the bar stays clean. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        {hasProject ? (
          <>
            <span className="muted hidden text-[10px] font-bold uppercase tracking-wider sm:inline">Project</span>
            <input
              className="min-w-0 max-w-[320px] truncate rounded-md bg-transparent px-2 py-1 text-center text-sm font-medium text-white outline-none transition-colors hover:bg-white/5 focus:bg-white/5 focus:ring-1 focus:ring-[var(--accent)]"
              value={projectName}
              onChange={(event) => onProjectNameChange(event.target.value)}
              aria-label="Project title"
              placeholder="Untitled"
            />
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="relative" onBlur={closeMenu}>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Settings"
            aria-expanded={menuOpen}
          >
            <Icon name="settings" size={20} />
          </button>
          {menuOpen ? (
            <div className="panel absolute right-0 top-12 z-30 w-48 space-y-2 p-3 text-sm shadow-xl">
              <button className="btn w-full justify-start" onClick={onToggleTheme}>
                {theme === 'dark' ? '☀ Light theme' : '☾ Dark theme'}
              </button>
              <InstallPrompt />
              <p className="muted px-1 text-xs">Video never leaves your device.</p>
            </div>
          ) : null}
        </div>

        {isExporting ? (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          className="btn btn-primary h-11 min-w-[150px] px-6 text-sm sm:min-w-[215px]"
          onClick={onExport}
          disabled={isExporting || !canExport}
          aria-label={exportLabel}
          title={exportLabel}
        >
          <Icon name="upload" size={20} />
          {isExporting ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </header>
  );
}
