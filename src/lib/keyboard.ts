/** Shortcuts must never hijack typing in titles, numbers, word edits or contenteditable UI. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export const isMac = (): boolean => /Mac|iPhone|iPad|iPod/.test(navigator.platform);
