import type { Item } from '@/lib/shared/types';

export const byTime = (a: Item, b: Item) =>
  (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99');

export const list = (items: Record<string, Item>) => Object.values(items);

/** Items on a given day (month-anchored to-dos don't belong to a single day). */
export const onDay = (items: Item[], d: string) => items.filter((x) => x.date === d && !(x.type === 'task' && x.month)).sort(byTime);

export const tasks = (items: Item[]) => items.filter((x) => x.type === 'task');

export const overdue = (items: Item[], today: string) => tasks(items).filter((x) => !x.done && x.date && x.date < today && !x.month);
