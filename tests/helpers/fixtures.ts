import type { Item } from '@/lib/shared/types';

let n = 0;
export function makeItem(p: Partial<Item> = {}): Item {
  const t = p.updatedAt ?? new Date().toISOString();
  return {
    id: p.id ?? `itest${++n}${Math.random().toString(36).slice(2, 6)}`,
    type: 'task',
    title: 'Something',
    date: null,
    time: null,
    dur: 0,
    project: null,
    done: false,
    doneAt: null,
    month: false,
    with: '',
    link: '',
    notes: '',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    ...p,
  };
}

export const later = (iso: string, ms = 1000) => new Date(Date.parse(iso) + ms).toISOString();
