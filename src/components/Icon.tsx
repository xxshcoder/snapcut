import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'layers'
  | 'scissors'
  | 'effects'
  | 'text'
  | 'pen'
  | 'brush'
  | 'sliders'
  | 'crop'
  | 'upload'
  | 'settings'
  | 'play'
  | 'pause'
  | 'back'
  | 'forward'
  | 'trash'
  | 'expand'
  | 'chevron'
  | 'tray'
  | 'eyedropper'
  | 'plus'
  | 'minus'
  | 'check'
  | 'image'
  | 'music'
  | 'close'
  | 'target'
  | 'cc'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'silence'
  | 'volume'
  | 'volumeOff'
  | 'fullscreen'
  | 'frameBack'
  | 'frameForward';

const PATHS: Record<IconName, ReactNode> = {
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 18 9 5 9-5" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 8 20 20M8 16 20 4" />
    </>
  ),
  effects: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 3a9 9 0 0 1 6.4 15.4" />
      <circle cx="8" cy="9" r="1" />
      <circle cx="14" cy="7" r="1" />
      <circle cx="7" cy="14" r="1" />
    </>
  ),
  text: <path d="M5 5h14M12 5v14M9 19h6" />,
  pen: (
    <>
      <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" />
      <path d="m14 6 3.5 3.5" />
    </>
  ),
  brush: (
    <>
      <path d="m14 4 6 6-8 8-6-6 8-8Z" />
      <path d="M6 12c-2 1-3 3-3 6 3 0 5-1 6-3" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  crop: <path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />,
  upload: (
    <>
      <path d="M7 17a5 5 0 0 1-.7-9.9 6 6 0 0 1 11.4 1.4A4 4 0 0 1 18 17" />
      <path d="M12 21V11m0 0-3 3m3-3 3 3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4h-.2a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  play: <path d="M8 5v14l11-7L8 5Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  back: (
    <>
      <path d="M4 4v6h6" />
      <path d="M5 10a8 8 0 1 1 0 5" />
    </>
  ),
  forward: (
    <>
      <path d="M20 4v6h-6" />
      <path d="M19 10a8 8 0 1 0 0 5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  expand: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  tray: (
    <>
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <path d="M4 15l3-4h10l3 4" />
      <path d="M12 3v9m0 0-3-3m3 3 3-3" />
    </>
  ),
  eyedropper: (
    <>
      <path d="m19 3 2 2-9 9-3-3 10-8Z" />
      <path d="M9 13c-3 0-5 2-5 5l-1 2 2-1c3 0 5-2 5-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </>
  ),
  close: <path d="M6 6 18 18M18 6 6 18" />,
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  cc: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M10 10a3 3 0 1 0 0 4M18 10a3 3 0 1 0 0 4" />
    </>
  ),
  undo: (
    <>
      <path d="M4 8h10a6 6 0 0 1 0 12H9" />
      <path d="m4 8 4-4M4 8l4 4" />
    </>
  ),
  redo: (
    <>
      <path d="M20 8H10a6 6 0 0 0 0 12h5" />
      <path d="m20 8-4-4m4 4-4 4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  silence: (
    <>
      <path d="M3 12h3l2-5 3 10 3-8 2 3h5" />
      <path d="M4 20 20 4" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M17 9l5 6m0-6-5 6" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </>
  ),
  frameBack: (
    <>
      <path d="M18 5v14L8 12l10-7Z" />
      <path d="M5 5v14" />
    </>
  ),
  frameForward: (
    <>
      <path d="M6 5v14l10-7L6 5Z" />
      <path d="M19 5v14" />
    </>
  ),
};

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
