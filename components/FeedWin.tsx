'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveToNotebook } from '@/lib/client/actions';
import { call, post } from '@/lib/client/api';
import { snd } from '@/lib/client/sound';
import { S, setDesk, useDesk } from '@/lib/client/store';
import { MON } from '@/lib/shared/dates';
import type { FeedItem, FeedSource } from '@/lib/shared/types';

const READ_KEY = 'desk.feed.read';

function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveRead(s: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...s].slice(-2000)));
  } catch {
    /* per-device convenience only */
  }
}

/** "today", "yesterday", "3 Nov", "3 Nov 2025". */
function rel(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}

/** feed.app — scroll your Substacks, read posts in place. */
export function FeedWin() {
  const [data, setData] = useState<{ sources: FeedSource[]; items: FeedItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [articles, setArticles] = useState<Record<string, string>>({});
  const [artErr, setArtErr] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => loadRead());
  const input = useRef<HTMLInputElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const tick = useDesk((s) => s.feedTick);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    const r = await call<{ sources: FeedSource[]; items: FeedItem[] }>('/api/feed' + (fresh ? '?fresh=1' : ''));
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError('');
      setDesk({ feedN: { posts: r.data.items.length, sources: r.data.sources.length } });
    } else setError('Couldn’t load your feed — check your connection.');
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15 * 60e3);
    return () => clearInterval(t);
  }, [load]);

  // The footer's Refresh button.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(true);
  }, [tick, load]);

  const items = useMemo(() => (data?.items ?? []).filter((x) => !filter || x.sourceId === filter), [data, filter]);
  const current = sel ? (data?.items.find((x) => x.id === sel) ?? null) : null;

  const open = async (it: FeedItem) => {
    setSel(it.id);
    setArtErr('');
    snd('tick');
    if (!read.has(it.id)) {
      const next = new Set(read).add(it.id);
      setRead(next);
      saveRead(next);
    }
    reader.current?.scrollTo({ top: 0 });
    if (articles[it.id] !== undefined) return;
    const r = await call<{ html: string }>(`/api/feed/article?id=${it.id}`);
    if (r.ok) setArticles((a) => ({ ...a, [it.id]: r.data.html }));
    else setArtErr(r.error || 'Couldn’t load this post.');
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.current?.value.trim();
    if (!v || adding) return;
    setAdding(true);
    setMsg('Looking for that Substack…');
    const r = await post<{ source: FeedSource }>('/api/feed/sources', { input: v });
    setAdding(false);
    if (r.ok) {
      setMsg(`Added ${r.data.source.title}.`);
      if (input.current) input.current.value = '';
      snd('key');
      void load();
    } else {
      setMsg(r.error || 'Couldn’t add that.');
      snd('err');
    }
  };

  const remove = async (s: FeedSource) => {
    if (!window.confirm(`Stop following ${s.title}?`)) return;
    const r = await call(`/api/feed/sources?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    if (r.ok) {
      if (filter === s.id) setFilter('');
      snd('del');
      void load();
    }
  };

  const sources = data?.sources ?? [];
  const html = current ? articles[current.id] : undefined;

  return (
    <div className={`fd ${current ? 'has' : ''}`}>
      <div className="flist">
        <form className="qa" onSubmit={add}>
          <input ref={input} name="q" placeholder="Add a Substack — name or address" aria-label="Add a Substack" autoComplete="off" />
          <button className="btn" disabled={adding}>
            {adding ? '…' : 'Add'}
          </button>
        </form>
        {msg && (
          <p className="tnow" role="status">
            {msg}
          </p>
        )}
        {sources.length > 0 && (
          <div className="fsrc" role="group" aria-label="Show">
            <button type="button" className={!filter ? 'on' : ''} aria-pressed={!filter} onClick={() => (setFilter(''), snd('tick'))}>
              All
            </button>
            {sources.map((s) => (
              <span key={s.id} className={`fchip ${filter === s.id ? 'on' : ''} ${s.error ? 'bad' : ''}`} title={s.error || s.url}>
                <button type="button" aria-pressed={filter === s.id} onClick={() => (setFilter(s.id), snd('tick'))}>
                  {s.title || s.url}
                </button>
                <button type="button" className="fx" aria-label={`Stop following ${s.title}`} onClick={() => void remove(s)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="empty">{error}</p>}
        {!data && !error && <p className="empty">{loading ? 'Loading your feed…' : ''}</p>}
        {data && !sources.length && (
          <p className="empty">Add a Substack above: a name like “lenny”, an address like “name.substack.com”, or its own domain.</p>
        )}
        {items.map((it) => (
          <button key={it.id} type="button" className={`fcard ${read.has(it.id) ? 'rd' : ''} ${it.id === sel ? 'on' : ''}`} onClick={() => void open(it)}>
            <span className="ftxt">
              <span className="fmeta">
                {it.sourceImage && <img src={it.sourceImage} alt="" loading="lazy" />}
                {it.sourceTitle} · {rel(it.date)}
              </span>
              <b>{it.title}</b>
              {it.subtitle && <span className="fsub">{it.subtitle}</span>}
            </span>
            {it.image && <img className="fimg" src={it.image} alt="" loading="lazy" />}
          </button>
        ))}
        {data && sources.length > 0 && !items.length && <p className="empty">No posts yet.</p>}
      </div>

      <div className="fread" ref={reader}>
        {current ? (
          <article key={current.id}>
            <button type="button" className="nback" onClick={() => setSel(null)}>
              ‹ All posts
            </button>
            <p className="fmeta">
              {current.sourceImage && <img src={current.sourceImage} alt="" />}
              {current.sourceTitle}
              {current.author ? ` · ${current.author}` : ''} · {rel(current.date)}
            </p>
            <h2>{current.title}</h2>
            {current.subtitle && <p className="fsub2">{current.subtitle}</p>}
            <div className="fbar">
              <a className="btn gh" href={current.link} target="_blank" rel="noopener noreferrer">
                Open on Substack ↗
              </a>
              <button type="button" className="btn gh" onClick={() => saveToNotebook(current.title, `${current.link}\n\n${current.subtitle}`.trim())}>
                Save to notebook
              </button>
            </div>
            {html !== undefined ? (
              // Cleaned on the server (sanitize-html): no scripts, styles, frames or event handlers.
              <div className="art" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="empty">{artErr || 'Loading…'}</p>
            )}
          </article>
        ) : (
          <p className="empty">Pick a post to read it here.</p>
        )}
      </div>
    </div>
  );
}

export function FeedFooter() {
  const n = useDesk((s) => s.feedN);
  return (
    <>
      <span>
        {n.posts} post{n.posts === 1 ? '' : 's'} from {n.sources} Substack{n.sources === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        onClick={() => {
          setDesk({ feedTick: S().feedTick + 1 });
          snd('click');
        }}
      >
        Refresh ↻
      </button>
    </>
  );
}
