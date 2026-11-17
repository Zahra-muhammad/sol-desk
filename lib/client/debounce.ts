// Debounced saves (notes, names) that can all be forced out at once —
// on blur, before a backup, and before the page unloads.

const pending = new Map<string, { t: ReturnType<typeof setTimeout>; fn: () => void }>();

export function debounced(key: string, fn: () => void, ms = 700) {
  const cur = pending.get(key);
  if (cur) clearTimeout(cur.t);
  const t = setTimeout(() => {
    pending.delete(key);
    fn();
  }, ms);
  pending.set(key, { t, fn });
}

/** Run one pending save now (e.g. on blur). */
export function flushDebounced(key: string) {
  const cur = pending.get(key);
  if (!cur) return;
  clearTimeout(cur.t);
  pending.delete(key);
  cur.fn();
}

export function flushAllDebounced() {
  for (const key of [...pending.keys()]) flushDebounced(key);
}

export function hasDebounced(key: string) {
  return pending.has(key);
}
