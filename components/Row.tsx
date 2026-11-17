'use client';

import { editItem, toggleDone } from '@/lib/client/actions';
import { pname, useDesk } from '@/lib/client/store';
import { MON, TODAY, fmtD, parse } from '@/lib/shared/dates';
import type { Item } from '@/lib/shared/types';

interface Opts {
  showDate?: boolean;
  noTime?: boolean;
  noProj?: boolean;
}

/** One line in a list: key (to-do) or marker, time, title, project chip, date. Click to edit. */
export function Row({ x, showDate, noTime, noProj }: { x: Item } & Opts) {
  const settings = useDesk((s) => s.settings);
  const late = x.type === 'task' && !x.done && !!x.date && x.date < TODAY();
  return (
    <div
      className={`row ${x.done ? 'dn' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.key')) return;
        editItem(x.id);
      }}
    >
      {x.type === 'task' ? (
        <button
          type="button"
          className={`key ${x.done ? 'on' : ''}`}
          aria-label={x.done ? `Mark “${x.title}” not done` : `Mark “${x.title}” done`}
          onClick={(e) => {
            e.stopPropagation();
            toggleDone(x.id);
          }}
        />
      ) : (
        <span className={`mk ${x.type}`} aria-hidden="true" />
      )}
      {!noTime && <span className="tm">{x.time || (x.type === 'task' ? '' : 'all day')}</span>}
      <button type="button" className="ti">
        {x.title}
      </button>
      {x.project && !noProj && <span className={`pj ${x.project}`}>{pname(settings, x.project)}</span>}
      {showDate && x.date && (
        <span className={`due ${late ? 'late' : ''}`}>{x.month ? MON[parse(x.date).getMonth()].slice(0, 3) : fmtD(x.date)}</span>
      )}
    </div>
  );
}
