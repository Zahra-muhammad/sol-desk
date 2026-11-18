'use client';

import type { Alarm, ChatMessage, Item, Note, Settings, TimeEntry } from '@/lib/shared/types';
import { closeWin, lockNow, openWin, receiveRecords, receiveSettings, showDesktop, toast } from './actions';
import { post } from './api';
import { snd } from './sound';
import { S, setDesk, type WinKey } from './store';

type Changed = { items?: Item[]; entries?: TimeEntry[]; notes?: Note[]; alarms?: Alarm[]; settings?: Settings };
type PlannerEvent =
  | { type: 'text'; text: string }
  | ({ type: 'changed' } & Changed)
  | { type: 'added'; items: Item[] }
  | { type: 'ui'; action: 'open' | 'close' | 'desktop' | 'lock'; window?: WinKey }
  | { type: 'done'; user: ChatMessage; assistant: ChatMessage }
  | { type: 'error'; error: string };

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** Ask the planner. The reply streams in; anything it changes (items, alarms, timer, notes, settings, windows) updates live. */
export async function ask(q: string) {
  if (S().chatBusy || !q.trim()) return;
  openWin('chat');
  setDesk({ chatBusy: true, live: { q, text: '' } });
  snd('click');

  let added = 0;
  // Things the planner deletes can be brought back with Undo, like your own deletes.
  const removed: Item[] = [];
  const fail = (error: string) => setDesk((s) => ({ live: { ...(s.live ?? { q, text: '' }), error } }));

  try {
    const res = await fetch('/api/planner', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message: q, tz: timeZone() }),
    });
    if (res.status === 401) {
      fail('Your desk locked. Unlock it and ask again.');
      lockNow('enter');
      return;
    }
    if (!res.ok || !res.body) {
      const b = await res.json().catch(() => ({}));
      fail(b?.error || 'Something went wrong. Try again in a moment.');
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let finished = false;
    const handle = (ev: PlannerEvent) => {
      if (ev.type === 'text') setDesk((s) => ({ live: s.live ? { ...s.live, text: s.live.text + ev.text } : s.live }));
      else if (ev.type === 'changed' || ev.type === 'added') {
        const cur = S().items;
        for (const it of ev.items ?? []) if (it.deletedAt && cur[it.id]) removed.push(cur[it.id]);
        const fresh = (ev.items ?? []).filter((it) => !it.deletedAt && !cur[it.id]).length;
        if (fresh) added += fresh;
        receiveRecords(ev);
        if (ev.type === 'changed' && ev.settings) receiveSettings(ev.settings);
        if (fresh) setDesk((s) => ({ live: s.live ? { ...s.live, added } : s.live }));
      } else if (ev.type === 'ui') {
        if (ev.action === 'open' && ev.window) openWin(ev.window);
        else if (ev.action === 'close' && ev.window) closeWin(ev.window);
        else if (ev.action === 'desktop') showDesktop();
        else if (ev.action === 'lock') setTimeout(() => lockNow('enter'), 1200);
      } else if (ev.type === 'done') {
        finished = true;
        setDesk((s) => ({ chat: [...s.chat, ev.user, ev.assistant].slice(-60), live: null }));
        snd('msg');
      } else if (ev.type === 'error') {
        finished = true;
        fail(ev.error);
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data) {
          try {
            handle(JSON.parse(data));
          } catch {
            /* ignore a malformed frame */
          }
        }
      }
    }
    if (!finished) fail('The reply was cut off. Try again.');
  } catch {
    fail('Couldn’t reach the planner — check your connection.');
  } finally {
    setDesk({ chatBusy: false });
    if (removed.length) {
      setDesk({ lastDeleted: { kind: 'items', recs: removed } });
      toast(`Planner deleted ${removed.length} item${removed.length > 1 ? 's' : ''}`, true);
    } else if (added) toast(`Planner added ${added} item${added > 1 ? 's' : ''}`);
  }
}

export async function clearChat() {
  const before = S();
  setDesk({ chat: [], live: null });
  snd('del');
  const r = await post('/api/chat/clear');
  if (!r.ok) {
    setDesk({ chat: before.chat });
    toast('Couldn’t clear the chat — check your connection');
  }
}
