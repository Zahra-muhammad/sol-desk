'use client';

import type { ChatMessage, Item } from '@/lib/shared/types';
import { lockNow, openWin, toast } from './actions';
import { post } from './api';
import { snd } from './sound';
import { S, setDesk } from './store';
import { mergeItems } from './sync';

type PlannerEvent =
  | { type: 'text'; text: string }
  | { type: 'added'; items: Item[] }
  | { type: 'done'; user: ChatMessage; assistant: ChatMessage }
  | { type: 'error'; error: string };

/** Ask the planner. The reply streams in; items it adds land on the calendar live. */
export async function ask(q: string) {
  if (S().chatBusy || !q.trim()) return;
  openWin('chat');
  setDesk({ chatBusy: true, live: { q, text: '' } });
  snd('click');

  let added = 0;
  const fail = (error: string) => setDesk((s) => ({ live: { ...(s.live ?? { q, text: '' }), error } }));

  try {
    const res = await fetch('/api/planner', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message: q }),
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
      else if (ev.type === 'added') {
        added += ev.items.length;
        setDesk((s) => ({ items: mergeItems(s.items, ev.items), live: s.live ? { ...s.live, added } : s.live }));
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
    if (added) toast(`Planner added ${added} item${added > 1 ? 's' : ''}`);
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
