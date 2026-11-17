// Mechanical "tick" clicks — like a mechanical keyboard key or a light switch.
// Pure Web Audio, no files. Each click = a low sine "thump" (BODY) + a band-passed noise "snap" (SNAP).

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let lastAt = -Infinity;

/** Never let sounds stack into a buzz: at most one sound per 30 ms. */
const MIN_GAP_MS = 30;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}
export function soundEnabled() {
  return enabled;
}

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctor();
      master = audioCtx.createGain();
      master.gain.value = 0.8;
      master.connect(audioCtx.destination);
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Browsers block audio until a gesture; called on the first click. */
export function primeAudio() {
  ctx();
}

/**
 * One mechanical click.
 * @param freq   body pitch in Hz (starts at 1.7× and drops to this within 12 ms)
 * @param snapHz band-pass centre for the noise snap
 * @param decay  length in seconds
 * @param vol    loudness
 * @param delay  start offset in seconds
 */
function click(freq: number, snapHz: number, decay: number, vol: number, delay = 0) {
  const a = ctx();
  if (!a || !master) return;
  const t = a.currentTime + delay + 0.005;
  // body
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.7, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.012);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + decay + 0.03);
  // snap
  const len = Math.floor(a.sampleRate * decay);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const n = a.createBufferSource();
  const bp = a.createBiquadFilter();
  const ng = a.createGain();
  n.buffer = buf;
  bp.type = 'bandpass';
  bp.frequency.value = snapHz;
  bp.Q.value = 1.1;
  ng.gain.value = vol * 0.9;
  n.connect(bp).connect(ng).connect(master);
  n.start(t);
}

export type Snd = 'click' | 'tick' | 'open' | 'close' | 'key' | 'unkey' | 'msg' | 'del' | 'err' | 'unlock';

/** The sound map. */
const MAP: Record<Snd, () => void> = {
  // buttons, icons, menus
  click: () => click(180, 4600, 0.04, 0.35),
  // hover, tabs, drag start/end
  tick: () => click(150, 2600, 0.014, 0.18),
  open: () => click(230, 5400, 0.045, 0.32),
  close: () => click(130, 3600, 0.05, 0.32),
  // to-do done: key press down, then up
  key: () => {
    click(110, 3000, 0.035, 0.42);
    click(210, 5600, 0.03, 0.25, 0.07);
  },
  unkey: () => click(160, 4200, 0.03, 0.3),
  del: () => {
    click(120, 2400, 0.06, 0.35);
    click(90, 1800, 0.05, 0.25, 0.06);
  },
  // Not in the reference map — made in the same click style:
  // planner replied: two light clicks
  msg: () => {
    click(200, 5000, 0.03, 0.22);
    click(240, 5600, 0.03, 0.2, 0.085);
  },
  // wrong password: two low, dull clicks
  err: () => {
    click(120, 2000, 0.05, 0.3);
    click(100, 1800, 0.05, 0.25, 0.09);
  },
  // unlocked: three rising clicks, 70 ms apart
  unlock: () => {
    click(180, 4600, 0.035, 0.25);
    click(230, 5200, 0.035, 0.25, 0.07);
    click(280, 5800, 0.035, 0.25, 0.14);
  },
};

export function snd(k: Snd) {
  if (!enabled) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  try {
    MAP[k]();
  } catch {
    /* sound is a nicety; never let it break a click */
  }
}

/** Hover tick for mouse users only (touch has no hover). */
export function hoverTick(e: { pointerType?: string }) {
  if (e.pointerType === 'mouse') snd('tick');
}
