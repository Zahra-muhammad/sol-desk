'use client';

import { useEffect, useRef, useState } from 'react';
import { afterUnlock, cancelChange, toast } from '@/lib/client/actions';
import { post } from '@/lib/client/api';
import { snd } from '@/lib/client/sound';
import { setDesk, useDesk } from '@/lib/client/store';
import { DOW, MON, pad } from '@/lib/shared/dates';
import { ArrowIcon } from './Glyphs';

type Phase = 'loading' | 'offline' | 'set' | 'enter' | 'change' | 'newpw';

const MSG: Record<Phase, string> = {
  loading: 'Waking up your desk…',
  offline: 'Your desk can’t be reached right now. Check your connection and reload.',
  set: 'Choose a password for your desk. Only you will know it.',
  enter: '',
  change: 'Enter your current password to change it.',
  newpw: 'Choose a new password.',
};

const MIN = 8;

function waitText(sec: number) {
  return sec > 90 ? `Too many tries. Wait ${Math.ceil(sec / 60)} min.` : `Too many tries. Wait ${sec}s.`;
}

/** Mac-style lock screen: big clock, date, avatar, pill password field. */
export function LockScreen() {
  const locked = useDesk((s) => s.locked);
  const lockMode = useDesk((s) => s.lockMode);
  const lockDetail = useDesk((s) => s.lockDetail);
  const [phase, setPhase] = useState<Phase>(lockMode);
  const [two, setTwo] = useState(false);
  const [msg, setMsg] = useState(MSG[lockMode]);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState({ t: '--:--', d: '' });
  const pw1 = useRef<HTMLInputElement>(null);
  const pw2 = useRef<HTMLInputElement>(null);
  const lk = useRef<HTMLDivElement>(null);
  const first = useRef('');
  const current = useRef('');

  const reset = (p: Phase, m = MSG[p]) => {
    setPhase(p);
    setTwo(false);
    setMsg(m);
    first.current = '';
    if (pw1.current) pw1.current.value = '';
    if (pw2.current) pw2.current.value = '';
    setTimeout(() => pw1.current?.focus(), 60);
  };

  useEffect(() => {
    if (locked) reset(lockMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, lockMode]);

  useEffect(() => {
    const paint = () => {
      const n = new Date();
      setClock({ t: pad(n.getHours()) + ':' + pad(n.getMinutes()), d: DOW[n.getDay()] + ' ' + n.getDate() + ' ' + MON[n.getMonth()] });
    };
    paint();
    const t = setInterval(paint, 5000);
    return () => clearInterval(t);
  }, []);

  const shake = () => {
    const k = lk.current;
    if (k) {
      k.classList.remove('shake');
      void k.offsetWidth;
      k.classList.add('shake');
    }
    snd('err');
  };

  const fail = (r: { status: number; error?: string; retryAfter?: number }, fallback = 'Wrong password.') => {
    if (pw1.current) pw1.current.value = '';
    if (r.status === 429) setMsg(waitText(r.retryAfter ?? 30));
    else if (r.status === 0) setMsg('Can’t reach your desk — check your connection.');
    else if (r.status === 401 && r.retryAfter) setMsg(`${fallback} ${waitText(r.retryAfter)}`);
    else if (r.status === 401) setMsg(fallback);
    else setMsg(r.error || 'Something went wrong. Try again.');
    shake();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v1 = pw1.current?.value ?? '';

    if (phase === 'set' || phase === 'newpw') {
      if (!two) {
        if (v1.length < MIN) {
          setMsg(`Use at least ${MIN} characters.`);
          shake();
          return;
        }
        first.current = v1;
        setTwo(true);
        setMsg('Type it once more to confirm.');
        snd('tick');
        setTimeout(() => pw2.current?.focus(), 40);
        return;
      }
      if ((pw2.current?.value ?? '') !== first.current) {
        shake();
        reset(phase, 'Those didn’t match — try again.');
        return;
      }
      setBusy(true);
      const r =
        phase === 'set'
          ? await post('/api/auth/setup', { password: first.current })
          : await post('/api/auth/password', { current: current.current, next: first.current });
      setBusy(false);
      if (!r.ok) {
        if (r.status === 401 && phase === 'newpw') {
          reset('change', 'Your current password changed. Enter it again.');
          shake();
          return;
        }
        if (r.status === 409) {
          setMsg('A password is already set. Reload the page.');
          shake();
          return;
        }
        reset(phase);
        fail(r, 'Couldn’t save your password.');
        return;
      }
      first.current = '';
      current.current = '';
      snd('unlock');
      if (phase === 'set') await afterUnlock();
      else setDesk({ locked: false });
      toast('Password saved');
      return;
    }

    if (phase === 'enter' || phase === 'change') {
      if (!v1) {
        shake();
        return;
      }
      setBusy(true);
      const r = phase === 'enter' ? await post('/api/auth/login', { password: v1 }) : await post('/api/auth/password', { current: v1 });
      setBusy(false);
      if (!r.ok) {
        fail(r);
        return;
      }
      if (phase === 'change') {
        current.current = v1;
        reset('newpw');
        snd('click');
        return;
      }
      if (pw1.current) pw1.current.value = '';
      setMsg('');
      snd('unlock');
      await afterUnlock();
    }
  };

  const hidePw1 = phase === 'loading' || phase === 'offline' || two;
  const changing = phase === 'change' || phase === 'newpw';
  const hint =
    phase === 'enter' || changing
      ? 'Forgot it? Run “npm run reset-password” where your desk is hosted, then choose a new one.'
      : phase === 'set'
        ? `At least ${MIN} characters. It locks after 30 minutes away.`
        : phase === 'offline' && lockDetail
          ? `Dev only — ${lockDetail}`
          : '';
  const newPw = phase === 'set' || phase === 'newpw';

  return (
    <div id="lock" className={locked ? 'on' : ''} role="dialog" aria-modal="true" aria-label="Locked">
      <div className="ltime">
        <b id="ltb">{clock.t}</b>
        <span id="lts">{clock.d}</span>
      </div>
      <div className="lk" ref={lk}>
        <div className="av" aria-hidden="true">
          S
        </div>
        <b>Sol</b>
        <form autoComplete="off" onSubmit={submit}>
          <div className="pw" id="pw1" hidden={hidePw1}>
            <input
              ref={pw1}
              type="password"
              name="pw"
              placeholder={newPw ? 'New password' : phase === 'change' ? 'Current password' : 'Enter password'}
              aria-label={newPw ? 'New password' : phase === 'change' ? 'Current password' : 'Password'}
              autoComplete={newPw ? 'new-password' : 'current-password'}
            />
            <button aria-label="Continue" disabled={busy}>
              <ArrowIcon />
            </button>
          </div>
          <div className="pw" id="pw2" hidden={!two}>
            <input ref={pw2} type="password" name="pw2" placeholder="Type it again" aria-label="Confirm password" autoComplete="new-password" />
            <button aria-label="Save password" disabled={busy}>
              <ArrowIcon />
            </button>
          </div>
        </form>
        <p className="lmsg" id="lmsg" role="status" aria-live="polite">
          {msg}
        </p>
        {changing && (
          <button type="button" className="lcancel" onClick={cancelChange}>
            Cancel
          </button>
        )}
      </div>
      <p className="lhint" id="lhint">
        {hint}
      </p>
    </div>
  );
}
