'use client';

import { useRef } from 'react';
import { addQuick } from '@/lib/client/actions';
import { quickAdd } from '@/lib/shared/quickAdd';
import type { ProjectKey } from '@/lib/shared/types';

/** Plain-language quick add: “call Ali tomorrow 3pm #1”. */
export function QuickAdd({ kind, project, placeholder, label }: { kind?: 'task'; project?: ProjectKey; placeholder: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      className="qa"
      onSubmit={(e) => {
        e.preventDefault();
        const el = ref.current;
        const v = el?.value.trim();
        if (!el || !v) return;
        const it = quickAdd(v);
        if (kind === 'task') {
          it.type = 'task';
          it.time = null;
          it.dur = 0;
        }
        if (project) it.project = project;
        el.value = '';
        addQuick(it);
      }}
    >
      <input ref={ref} name="q" placeholder={placeholder} autoComplete="off" aria-label={label} />
      <button className="btn">Add</button>
    </form>
  );
}
