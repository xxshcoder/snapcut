export type WakeLockHandle = { release: () => Promise<void> };

type WakeLockSentinelLike = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

/** Screen Wake Lock with automatic re-acquisition when the tab becomes visible. */
export async function acquireWakeLock(): Promise<WakeLockHandle | null> {
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock || document.visibilityState === 'hidden') return null;
  let sentinel: WakeLockSentinelLike | null = null;
  let releasedByUs = false;

  const request = async (): Promise<void> => {
    if (releasedByUs || document.visibilityState === 'hidden' || sentinel && !sentinel.released) return;
    try {
      sentinel = await nav.wakeLock?.request('screen') ?? null;
    } catch {
      sentinel = null;
    }
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void request();
    else void sentinel?.release().catch(() => undefined);
  };
  await request();
  document.addEventListener('visibilitychange', onVisibility);

  return {
    release: async () => {
      releasedByUs = true;
      document.removeEventListener('visibilitychange', onVisibility);
      await sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
  };
}
