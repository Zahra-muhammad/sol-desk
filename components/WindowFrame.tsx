'use client';

import { useRef } from 'react';
import { W, closeWin, focusWin, setGeo, toggleMax, wname } from '@/lib/client/actions';
import { snd } from '@/lib/client/sound';
import { S, useDesk, type WinKey } from '@/lib/client/store';
import { Glyph } from './Glyphs';
import { WindowBody, WindowFooter, hasFooter } from './windows';

export function WindowFrame({ k }: { k: WinKey }) {
  const g = useDesk((s) => s.geo[k]);
  const z = useDesk((s) => s.stack.indexOf(k));
  const maxed = useDesk((s) => s.maxed.includes(k));
  const title = useDesk((s) => wname(k, s.settings, s.items, s.editing));
  const ref = useRef<HTMLElement>(null);
  if (!g) return null;

  const def = W[k];
  const style: React.CSSProperties = {
    left: g.x,
    top: g.y,
    width: g.w,
    zIndex: 10 + Math.max(0, z),
    ...(g.h ? { height: g.h } : { maxHeight: 'calc(100% - 24px)' }),
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const w = ref.current;
    if (!w) return;
    focusWin(k);
    if (window.innerWidth <= 760) return;
    const target = e.target as HTMLElement;
    const tb = target.closest('.tb');
    const rs = target.closest('.rs');
    if (!((tb && !target.closest('button')) || rs)) return;
    if (w.classList.contains('max')) return;
    e.preventDefault();
    const desk = w.parentElement!;
    const d = { rs: !!rs, sx: e.clientX, sy: e.clientY, x: w.offsetLeft, y: w.offsetTop, ww: w.offsetWidth, hh: w.offsetHeight };
    w.setPointerCapture?.(e.pointerId);
    snd('tick');

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - d.sx;
      const dy = ev.clientY - d.sy;
      if (d.rs) {
        w.style.width = Math.max(300, d.ww + dx) + 'px';
        w.style.height = Math.max(220, d.hh + dy) + 'px';
        w.style.maxHeight = 'none';
      } else {
        w.style.left = Math.min(desk.clientWidth - 80, Math.max(-w.offsetWidth + 120, d.x + dx)) + 'px';
        w.style.top = Math.min(desk.clientHeight - 38, Math.max(0, d.y + dy)) + 'px';
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const prev = S().geo[k];
      setGeo(k, {
        x: w.offsetLeft,
        y: w.offsetTop,
        w: w.offsetWidth,
        h: d.rs ? w.offsetHeight : (prev?.h ?? (w.style.height ? parseInt(w.style.height) : null)),
      });
      snd('tick');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const isProject = k === 'p1' || k === 'p2';
  return (
    <section
      ref={ref}
      className={`win ${maxed ? 'max' : ''}`}
      id={'w-' + k}
      data-k={k}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      style={style}
      onPointerDown={onPointerDown}
    >
      <div
        className="tb"
        onDoubleClick={() => {
          if (window.innerWidth > 760) toggleMax(k);
        }}
      >
        <span className="fn">
          <Glyph kind={def.icon} />
          <span className="wt">
            {title}
            {isProject ? '/' : ''}
          </span>
        </span>
        <span className="wb">
          <button type="button" className="m" aria-label={maxed ? `Exit full size: ${title}` : `Full size: ${title}`} onClick={() => toggleMax(k)} />
          <button type="button" className="x" aria-label={`Close ${title}`} onClick={() => closeWin(k)} />
        </span>
      </div>
      <div className="bd" style={def.flush ? { padding: 0, overflow: 'hidden' } : undefined}>
        <WindowBody k={k} />
      </div>
      {hasFooter(k) && (
        <div className="ft">
          <WindowFooter k={k} />
        </div>
      )}
      <div className="rs" aria-hidden="true" />
    </section>
  );
}
