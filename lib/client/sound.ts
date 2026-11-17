// Soft, Mac-like UI sounds — trackpad taps, little pops and glassy tinks, all quiet.
// Pure Web Audio, no files. Recipes are the prototype's.

let AC: AudioContext | null = null;
let MS: GainNode | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}
export function soundEnabled() {
  return enabled;
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!AC) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      AC = new Ctor();
      const c = AC.createDynamicsCompressor();
      c.threshold.value = -24;
      c.ratio.value = 3;
      MS = AC.createGain();
      MS.gain.value = 0.55;
      MS.connect(c).connect(AC.destination);
    } catch {
      return null;
    }
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}

/** Browsers block audio until a gesture; call on the first pointerdown. */
export function primeAudio() {
  ac();
}

interface PingOpts {
  delay?: number;
  lp?: number;
  type?: OscillatorType;
  to?: number;
  att?: number;
}

function ping(f: number, dur: number, vol: number, o: PingOpts = {}) {
  const a = ac();
  if (!a || !MS) return;
  const t = a.currentTime + 0.004 + (o.delay || 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.lp || 5200;
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur * 0.55);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (o.att || 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(lp).connect(g).connect(MS);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** "Trackpad tap": 12 ms noise burst through a 3.2 kHz band-pass, plus a tiny 1850 Hz sine. */
function tap(vol = 1, delay = 0) {
  const a = ac();
  if (!a || !MS) return;
  const t = a.currentTime + 0.004 + delay;
  const len = Math.floor(a.sampleRate * 0.012);
  const b = a.createBuffer(1, len, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const n = a.createBufferSource();
  const bp = a.createBiquadFilter();
  const lp = a.createBiquadFilter();
  const g = a.createGain();
  n.buffer = b;
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 2.2;
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.003);
  n.connect(bp).connect(lp).connect(g).connect(MS);
  n.start(t);
  ping(1850, 0.022, 0.035 * vol, { delay });
}

export type Snd = 'click' | 'tick' | 'open' | 'close' | 'key' | 'unkey' | 'msg' | 'del' | 'err' | 'unlock';

export function snd(k: Snd) {
  if (!enabled) return;
  try {
    if (k === 'click') tap(1);
    else if (k === 'tick') tap(0.55);
    else if (k === 'open') ping(620, 0.07, 0.07, { to: 1180 });
    else if (k === 'close') ping(980, 0.07, 0.06, { to: 520 });
    else if (k === 'key') {
      tap(0.8);
      ping(2093, 0.22, 0.045, { delay: 0.02 });
      ping(3136, 0.16, 0.02, { delay: 0.02 });
    } else if (k === 'unkey') tap(0.7);
    else if (k === 'msg') {
      ping(1319, 0.2, 0.04);
      ping(1760, 0.24, 0.04, { delay: 0.085 });
    } else if (k === 'del') ping(440, 0.11, 0.055, { to: 240, type: 'triangle', lp: 2200 });
    else if (k === 'err') {
      ping(196, 0.16, 0.06, { type: 'triangle', lp: 900 });
      ping(165, 0.18, 0.05, { type: 'triangle', lp: 900, delay: 0.09 });
    } else if (k === 'unlock') {
      [880, 1175, 1568].forEach((f, i) => ping(f, 0.22, 0.04, { delay: i * 0.07 }));
    }
  } catch {
    /* audio is a nicety; never let it break a click */
  }
}
