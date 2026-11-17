'use client';

import { useMemo } from 'react';
import { deleteNote, isPhone, newNote, updateNote } from '@/lib/client/actions';
import { ask } from '@/lib/client/chat';
import { useNow } from '@/lib/client/hooks';
import { snd } from '@/lib/client/sound';
import { setDesk, useDesk } from '@/lib/client/store';
import { fmtD, iso, pad } from '@/lib/shared/dates';
import type { Note } from '@/lib/shared/types';
import { AutoNote } from './AutoNote';

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';
const noteTitle = (n: Note) => n.title.trim() || firstLine(n.body).slice(0, 80) || 'Untitled';

function when(isoTs: string) {
  const d = new Date(isoTs);
  const day = iso(d);
  const rel = fmtD(day);
  return rel === 'today' ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : rel;
}

function useNotes() {
  const map = useDesk((s) => s.notes);
  return useMemo(() => Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [map]);
}

/** notebook.md — a list of notes and the one you're writing. Everything autosaves. */
export function Notebook() {
  useNow(60e3);
  const all = useNotes();
  const sel = useDesk((s) => s.noteSel);
  const q = useDesk((s) => s.noteQ);
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter((n) => (n.title + '\n' + n.body).toLowerCase().includes(needle)) : all;
  // On a wide window, open the newest note if none is picked; on a phone, show the list first.
  const cur = (sel && all.find((n) => n.id === sel)) || (!isPhone() && !sel ? list[0] : null) || null;
  const words = cur ? (cur.body.trim().match(/\S+/g)?.length ?? 0) : 0;

  return (
    <div className={`nb ${cur ? 'has' : ''}`}>
      <div className="nlist">
        <div className="qa">
          <input
            className="in"
            type="search"
            value={q}
            placeholder="Search notes"
            aria-label="Search notes"
            onChange={(e) => setDesk({ noteQ: e.target.value })}
          />
          <button type="button" className="btn" onClick={newNote}>
            + New
          </button>
        </div>
        {list.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`nrow ${n.id === cur?.id ? 'on' : ''}`}
            aria-current={n.id === cur?.id ? 'true' : undefined}
            onClick={() => {
              setDesk({ noteSel: n.id });
              snd('tick');
            }}
          >
            <b>{noteTitle(n)}</b>
            <span>
              {when(n.updatedAt)}
              {firstLine(n.body) && firstLine(n.body) !== noteTitle(n) ? ' · ' + firstLine(n.body) : ''}
            </span>
          </button>
        ))}
        {!list.length && <p className="empty">{needle ? 'No notes match.' : 'No notes yet. Start one with + New.'}</p>}
      </div>
      <div className="ned">
        {cur ? (
          <div className="nedi" key={cur.id}>
            <button type="button" className="nback" onClick={() => setDesk({ noteSel: null })}>
              ‹ All notes
            </button>
            <AutoNote
              single
              className="pname ntitle"
              value={cur.title}
              saveKey={'note.title.' + cur.id}
              placeholder="Title"
              aria-label="Note title"
              onSave={(v) => updateNote(cur.id, { title: v })}
            />
            <div className="hd" style={{ marginTop: 0 }}>
              Edited {when(cur.updatedAt)} · {words} word{words === 1 ? '' : 's'}
              <button type="button" onClick={() => deleteNote(cur.id)}>
                Delete
              </button>
            </div>
            <AutoNote
              className="in nbody"
              value={cur.body}
              saveKey={'note.body.' + cur.id}
              placeholder="Write anything…"
              aria-label="Note"
              onSave={(v) => updateNote(cur.id, { body: v })}
            />
          </div>
        ) : (
          <p className="empty">{all.length ? 'Pick a note, or start a new one.' : 'Your notebook is empty.'}</p>
        )}
      </div>
    </div>
  );
}

export function NotebookFooter() {
  const n = useDesk((s) => Object.keys(s.notes).length);
  return (
    <>
      <span>
        {n} note{n === 1 ? '' : 's'}
      </span>
      <button type="button" onClick={() => void ask('Read my notebook and turn anything I need to act on into a short plan')}>
        Plan from notes →
      </button>
    </>
  );
}
