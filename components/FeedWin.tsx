'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/client/actions';
import { call, post } from '@/lib/client/api';
import { snd } from '@/lib/client/sound';
import { S, setDesk, useDesk } from '@/lib/client/store';
import { MON } from '@/lib/shared/dates';
import { TOPICS, articleDocument, articleFileName, isTopic } from '@/lib/shared/feed';
import type { FeedItem, SavedArticle } from '@/lib/shared/types';

const READ_KEY = 'desk.feed.read';
const PREFS_KEY = 'desk.feed.prefs';

type Tab = 'discover' | 'saved';

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

function loadPrefs(): { tab: Tab; topic: number } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { tab: p.tab === 'saved' ? 'saved' : 'discover', topic: isTopic(Number(p.topic)) ? Number(p.topic) : 0 };
  } catch {
    return { tab: 'discover', topic: 0 };
  }
}

function savePrefs(p: { tab: Tab; topic: number }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
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

/** Hands the article over as a self-contained .html file: the share sheet on phones (Save to Files), a download elsewhere. */
async function downloadArticle(it: FeedItem, html: string) {
  const name = articleFileName(it.title);
  const file = new File([articleDocument({ ...it, html })], name, { type: 'text/html' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: it.title });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  snd('key');
  toast(`Downloaded ${name}`);
}

function Card({ it, on, rd, when, onOpen }: { it: FeedItem; on: boolean; rd: boolean; when: string; onOpen: () => void }) {
  return (
    <button type="button" className={`fcard ${rd ? 'rd' : ''} ${on ? 'on' : ''}`} onClick={onOpen}>
      <span className="ftxt">
        <span className="fmeta">
          {it.sourceImage && <img src={it.sourceImage} alt="" loading="lazy" />}
          <span>
            {it.sourceTitle}
            {when ? ` · ${when}` : ''}
          </span>
        </span>
        <b>{it.title}</b>
        {it.subtitle && <span className="fsub">{it.subtitle}</span>}
      </span>
      {it.image && <img className="fimg" src={it.image} alt="" loading="lazy" />}
    </button>
  );
}

/** feed.app — random posts from across Substack, a fresh set every time it opens; save or download the ones you like. */
export function FeedWin() {
  const [tab, setTab] = useState<Tab>(() => loadPrefs().tab);
  const [topic, setTopic] = useState<number>(() => loadPrefs().topic);
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedArticle[] | null>(null);
  const [savedErr, setSavedErr] = useState('');
  const [sel, setSel] = useState<FeedItem | null>(null);
  const [articles, setArticles] = useState<Record<string, string>>({});
  const [artErr, setArtErr] = useState('');
  const [busy, setBusy] = useState('');
  const [read, setRead] = useState<Set<string>>(() => loadRead());
  const list = useRef<HTMLDivElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const tick = useDesk((s) => s.feedTick);

  const savedIds = useMemo(() => new Set((saved ?? []).map((x) => x.id)), [saved]);

  const shuffle = useCallback(async (t: number) => {
    const n = ++seq.current;
    setLoading(true);
    setError('');
    const r = await call<{ items: FeedItem[] }>('/api/feed' + (t ? `?topic=${t}` : ''));
    if (n !== seq.current) return; // a newer shuffle has started
    setLoading(false);
    if (r.ok) {
      setItems(r.data.items);
      list.current?.scrollTo({ top: 0 });
    } else setError(r.error || 'Couldn’t reach Substack — check your connection and Shuffle again.');
  }, []);

  const loadSaved = useCallback(async () => {
    const r = await call<{ saved: SavedArticle[] }>('/api/feed/saved');
    if (r.ok) {
      setSaved(r.data.saved);
      setSavedErr('');
    } else setSavedErr('Couldn’t load your saved articles.');
  }, []);

  // A fresh random set every time the app opens.
  useEffect(() => {
    void shuffle(loadPrefs().topic);
    void loadSaved();
  }, [shuffle, loadSaved]);

  // The footer's Shuffle button (only a new tick triggers this, so the topic is read through a ref).
  const topicRef = useRef(topic);
  topicRef.current = topic;
  const lastTick = useRef(tick);
  useEffect(() => {
    if (tick === lastTick.current) return;
    lastTick.current = tick;
    setTab('discover');
    savePrefs({ tab: 'discover', topic: topicRef.current });
    void shuffle(topicRef.current);
  }, [tick, shuffle]);

  useEffect(() => {
    setDesk({ feedN: { posts: items?.length ?? 0, saved: saved?.length ?? 0 } });
  }, [items, saved]);

  const pickTab = (t: Tab) => {
    setTab(t);
    savePrefs({ tab: t, topic });
    snd('tick');
    if (t === 'saved') void loadSaved();
  };

  const pickTopic = (t: number) => {
    setTopic(t);
    savePrefs({ tab, topic: t });
    snd('tick');
    void shuffle(t);
  };

  const open = async (it: FeedItem) => {
    setSel(it);
    setArtErr('');
    snd('tick');
    if (!read.has(it.id)) {
      const next = new Set(read).add(it.id);
      setRead(next);
      saveRead(next);
    }
    reader.current?.scrollTo({ top: 0 });
    if (articles[it.id] !== undefined) return;
    // A saved article opens from its kept copy; anything else straight from Substack.
    const r = savedIds.has(it.id)
      ? await call<{ article: SavedArticle }>(`/api/feed/saved?id=${it.id}`).then((x) => (x.ok ? { ok: true as const, html: x.data.article.html ?? '' } : x))
      : await call<{ html: string }>(`/api/feed/article?feed=${encodeURIComponent(it.feed)}&id=${it.id}`).then((x) => (x.ok ? { ok: true as const, html: x.data.html } : x));
    if (r.ok) setArticles((a) => ({ ...a, [it.id]: r.html }));
    else setArtErr(r.error || 'Couldn’t load this post — check your connection.');
  };

  const toggleSave = async (it: FeedItem) => {
    if (busy) return;
    if (savedIds.has(it.id)) {
      if (!window.confirm(`Remove “${it.title}” from Saved?`)) return;
      setBusy(it.id);
      const r = await call(`/api/feed/saved?id=${it.id}`, { method: 'DELETE' });
      setBusy('');
      if (r.ok) {
        setSaved((s) => (s ?? []).filter((x) => x.id !== it.id));
        snd('del');
        toast('Removed from Saved');
      } else toast('Couldn’t remove it — try again.');
      return;
    }
    setBusy(it.id);
    const r = await post<{ article: SavedArticle }>('/api/feed/saved', { feed: it.feed, id: it.id });
    setBusy('');
    if (r.ok) {
      setSaved((s) => [r.data.article, ...(s ?? []).filter((x) => x.id !== it.id)]);
      snd('key');
      toast('Saved — it’s in the Saved tab');
    } else {
      snd('err');
      toast(r.error || 'Couldn’t save it — try again.');
    }
  };

  const current = sel;
  const html = current ? articles[current.id] : undefined;
  const isSaved = !!current && savedIds.has(current.id);

  return (
    <div className={`fd ${current ? 'has' : ''}`}>
      <div className="flist" ref={list}>
        <div className="ftabs" role="group" aria-label="Show">
          <button type="button" aria-pressed={tab === 'discover'} onClick={() => pickTab('discover')}>
            Discover
          </button>
          <button type="button" aria-pressed={tab === 'saved'} onClick={() => pickTab('saved')}>
            Saved{saved?.length ? ` · ${saved.length}` : ''}
          </button>
        </div>

        {tab === 'discover' ? (
          <>
            <label className="ftopic">
              <span>Topic</span>
              <select className="in" value={topic} onChange={(e) => pickTopic(Number(e.target.value))}>
                <option value={0}>Any — surprise me</option>
                {TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {loading ? (
              <div aria-busy="true">
                <p className="tnow" role="status">
                  Finding random posts…
                </p>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="fskel" />
                ))}
              </div>
            ) : error ? (
              <p className="empty">{error}</p>
            ) : (
              <>
                {(items ?? []).map((it) => (
                  <Card key={it.id} it={it} on={it.id === sel?.id} rd={read.has(it.id)} when={rel(it.date)} onOpen={() => void open(it)} />
                ))}
              </>
            )}
            {!loading && (
              <button type="button" className="btn gh fmore" onClick={() => (snd('click'), void shuffle(topic))}>
                Shuffle — new random posts ↻
              </button>
            )}
          </>
        ) : (
          <>
            {savedErr && <p className="empty">{savedErr}</p>}
            {!saved && !savedErr && <p className="empty">Loading…</p>}
            {saved && !saved.length && <p className="empty">Nothing saved yet. Open a post and tap ♡ Save to keep it here — it stays readable even if the post is taken down.</p>}
            {(saved ?? []).map((it) => (
              <Card key={it.id} it={it} on={it.id === sel?.id} rd={false} when={`saved ${rel(it.savedAt)}`} onOpen={() => void open(it)} />
            ))}
          </>
        )}
      </div>

      <div className="fread" ref={reader}>
        {current ? (
          <article key={current.id}>
            <button type="button" className="nback" onClick={() => setSel(null)}>
              ‹ Back
            </button>
            <p className="fmeta">
              {current.sourceImage && <img src={current.sourceImage} alt="" />}
              <span>
                {current.sourceTitle}
                {current.author ? ` · ${current.author}` : ''}
                {current.date ? ` · ${rel(current.date)}` : ''}
              </span>
            </p>
            <h2>{current.title}</h2>
            {current.subtitle && <p className="fsub2">{current.subtitle}</p>}
            <div className="fbar">
              <button type="button" className={`btn gh ${isSaved ? 'on' : ''}`} aria-pressed={isSaved} disabled={busy === current.id} onClick={() => void toggleSave(current)}>
                {busy === current.id ? '…' : isSaved ? '♥ Saved' : '♡ Save'}
              </button>
              <button type="button" className="btn gh" disabled={html === undefined} onClick={() => html !== undefined && void downloadArticle(current, html)}>
                Download ⤓
              </button>
              <a className="btn gh" href={current.link} target="_blank" rel="noopener noreferrer">
                Open on Substack ↗
              </a>
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
        {n.posts} random post{n.posts === 1 ? '' : 's'} · {n.saved} saved
      </span>
      <button
        type="button"
        onClick={() => {
          setDesk({ feedTick: S().feedTick + 1 });
          snd('click');
        }}
      >
        Shuffle ↻
      </button>
    </>
  );
}
