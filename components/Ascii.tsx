'use client';

import { useEffect, useRef } from 'react';

const CH = ' .:-=+xX';

/**
 * The huge ASCII "sol." behind the windows. Characters near the cursor turn green and flicker,
 * and a few random ones flicker on their own. ~10 fps, paused while the tab is hidden,
 * static under prefers-reduced-motion.
 */
export function Ascii() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const desk = cv.parentElement!;
    const cx = cv.getContext('2d');
    if (!cx) return;
    const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let G: { grid: [number, number, string, number][] } | null = null;
    let mx = -999;
    let my = -999;
    let lit = new Map<number, number>();
    let base = '#4d4d4d';
    let green = '#62ff8d';
    let mono = '"JetBrains Mono",monospace';
    let sans = 'Inter,sans-serif';

    // Theme colours come from light-dark() tokens, so resolve them on a real element.
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    desk.appendChild(probe);
    const readColors = () => {
      probe.style.color = 'var(--ascii)';
      base = getComputedStyle(probe).color || base;
      probe.style.color = 'var(--green)';
      green = getComputedStyle(probe).color || green;
      const bs = getComputedStyle(document.body);
      mono = (bs.getPropertyValue('--font-mono').trim() || '"JetBrains Mono"') + ',monospace';
      sans = (bs.getPropertyValue('--font-ui').trim() || 'Inter') + ',sans-serif';
    };

    const draw = () => {
      if (!G) return;
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.font = '500 11px ' + mono;
      const now = performance.now();
      for (const [x, y, ch, i] of G.grid) {
        const dx = x - mx;
        const dy = y - my;
        const dd = dx * dx + dy * dy;
        const l = lit.get(i);
        if (dd < 9000 || (l && l > now)) {
          cx.fillStyle = green;
          cx.fillText(dd < 9000 && Math.random() < 0.3 ? CH[1 + ((Math.random() * 7) | 0)] : ch, x, y);
        } else {
          cx.fillStyle = base;
          cx.fillText(ch, x, y);
        }
      }
    };

    const build = () => {
      readColors();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = desk.clientWidth;
      const h = desk.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cw = 7;
      const chh = 12;
      const cols = Math.ceil(w / cw);
      const rows = Math.ceil(h / chh);
      const o = document.createElement('canvas');
      o.width = cols;
      o.height = rows;
      const oc = o.getContext('2d');
      if (!oc || !cols || !rows) return;
      const word = 'sol.';
      const fs = Math.min(rows * 0.62, ((cols * 0.55) / word.length) * 1.9);
      oc.fillStyle = '#000';
      oc.fillRect(0, 0, cols, rows);
      oc.fillStyle = '#fff';
      oc.font = `800 ${fs}px ${sans}`;
      oc.textAlign = 'center';
      oc.textBaseline = 'middle';
      const iconsW = innerWidth > 760 ? 190 / cw : 0;
      oc.fillText(word, (cols - iconsW) / 2 + cols * 0.04, rows * 0.56);
      const px = oc.getImageData(0, 0, cols, rows).data;
      const grid: [number, number, string, number][] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const v = px[(r * cols + c) * 4] / 255;
          let ch = '';
          if (v > 0.08) {
            const up = r > 0 ? px[((r - 1) * cols + c) * 4] / 255 : 0;
            const dn = r < rows - 1 ? px[((r + 1) * cols + c) * 4] / 255 : 0;
            const lf = c > 0 ? px[(r * cols + c - 1) * 4] / 255 : 0;
            const rt = c < cols - 1 ? px[(r * cols + c + 1) * 4] / 255 : 0;
            const edge = Math.min(up, dn, lf, rt) < 0.5;
            ch = edge ? (v > 0.6 ? 'X' : v > 0.3 ? 'x' : ':') : Math.random() < 0.92 ? 'X' : 'x';
          } else if (Math.random() < 0.004 && r < rows * 0.35) ch = Math.random() < 0.5 ? '.' : ':';
          if (ch) grid.push([c * cw, r * chh + 10, ch, r * cols + c]);
        }
      G = { grid };
      draw();
    };

    let raf = 0;
    let lastF = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - lastF < 90 || document.hidden) return;
      lastF = t;
      if (G) {
        for (let k = 0; k < 6; k++) {
          const g = G.grid[(Math.random() * G.grid.length) | 0];
          if (g) lit.set(g[3], t + 300 + Math.random() * 700);
        }
        if (lit.size > 400) lit = new Map([...lit].filter(([, v]) => v > t));
      }
      draw();
    };

    const onMove = (e: PointerEvent) => {
      const r = desk.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    };
    const onLeave = () => {
      mx = my = -999;
    };
    desk.addEventListener('pointermove', onMove);
    desk.addEventListener('pointerleave', onLeave);

    let rT: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(rT);
      rT = setTimeout(build, 120);
    });
    ro.observe(desk);
    document.fonts?.ready.then(build);
    build();
    if (!RM) raf = requestAnimationFrame(loop);

    const mo = new MutationObserver(() => {
      readColors();
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      clearTimeout(rT);
      desk.removeEventListener('pointermove', onMove);
      desk.removeEventListener('pointerleave', onLeave);
      probe.remove();
    };
  }, []);

  return <canvas id="ascii" ref={ref} aria-hidden="true" />;
}
