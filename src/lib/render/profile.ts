import { RENDER } from '../../config';
import type { Capabilities } from '../../types';
import type { RenderProfile } from './renderClip';

type DeviceWithMemory = Navigator & { deviceMemory?: number };

/** Pick a safe output profile for the current device. */
export function pickRenderProfile(caps: Capabilities | null): RenderProfile {
  const memory = typeof navigator !== 'undefined' ? (navigator as DeviceWithMemory).deviceMemory : undefined;
  if (memory !== undefined && memory <= 2) return RENDER.lowMemory;
  if (caps?.isMobile) return RENDER.phone;
  return RENDER.desktop;
}
