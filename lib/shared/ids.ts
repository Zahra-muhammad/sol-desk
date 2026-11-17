/** Short, sortable-ish item id, same shape as the prototype's (`i` + time + random). */
export function uid(): string {
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return 'i' + Date.now().toString(36) + rand;
}

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
