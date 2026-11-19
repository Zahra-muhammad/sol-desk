import { useId } from 'react';
import type { WinKey } from '@/lib/client/store';

export function Glyph({ kind }: { kind: 'file' | 'dir' | 'app' }) {
  if (kind === 'dir')
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z" />
      </svg>
    );
  if (kind === 'app')
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <path d="M2 5.5h12" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M4 1.5h5l3.5 3.5v9.5H4z" />
      <path d="M9 1.5V5h3.5" />
    </svg>
  );
}

export const SpeakerOn = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" />
    <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" />
  </svg>
);

export const SpeakerOff = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" />
    <path d="m11 6 4 4m0-4-4 4" />
  </svg>
);

export const LockIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7.5" rx="1.6" />
    <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" />
  </svg>
);

export const SunIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
  </svg>
);

export const DesktopIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
  </svg>
);

export const MailIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
    <path d="m2 4 6 5 6-5" />
  </svg>
);

export const StartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M2 3l6-1v5.5H2zM9 1.8 14.5 1v6.5H9zM2 8.5h6V14l-6-1zM9 8.5h5.5V15L9 14.2z" />
  </svg>
);

export const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

const BG = '#141414';
const keys = [0, 1, 2, 3];

/** The illustrated 62×50 desktop tiles from the prototype's thumb(). */
export function Thumb({ k, style }: { k: WinKey; style?: React.CSSProperties }) {
  const gid = useId();
  const d = new Date().getDate();
  let body: React.ReactNode = null;
  switch (k) {
    case 'today':
      body = (
        <>
          <rect width="62" height="50" fill="#ffc93c" />
          <rect x="12" y="7" width="38" height="38" rx="4" fill="#fff8e1" />
          <rect x="12" y="7" width="38" height="9" rx="4" fill="#ff4a3a" />
          <rect x="12" y="12" width="38" height="4" fill="#ff4a3a" />
          <text x="31" y="38" textAnchor="middle" style={{ fontFamily: 'var(--font-ui),Inter,sans-serif' }} fontWeight="700" fontSize="17" fill="#141414">
            {d}
          </text>
        </>
      );
      break;
    case 'calendar':
      body = (
        <>
          <rect width="62" height="50" fill="#e9e9e9" />
          <rect x="8" y="8" width="46" height="34" rx="3" fill="#fff" stroke="#bbb" />
          {[0, 1, 2, 3, 4].map((c) =>
            [0, 1, 2].map((r) => (
              <rect
                key={c + '-' + r}
                x={11 + c * 8.6}
                y={16 + r * 8.4}
                width="6"
                height="5.5"
                rx="1"
                fill={(c + r * 5) % 7 === 3 ? '#4c6bff' : (c + r) % 5 === 1 ? '#ff4a3a' : '#ddd'}
              />
            )),
          )}
          <rect x="8" y="8" width="46" height="5" rx="2" fill="#141414" />
        </>
      );
      break;
    case 'meetings':
      body = (
        <>
          <rect width="62" height="50" fill="#2b2b2b" />
          <rect x="9" y="7" width="44" height="32" rx="5" fill="#d9d4c7" />
          <rect x="13" y="11" width="30" height="24" rx="3" fill="#1d3cff" />
          <circle cx="22" cy="21" r="4" fill="#ffc8a8" />
          <rect x="17" y="26" width="10" height="9" rx="4" fill="#ff6fc1" />
          <circle cx="35" cy="21" r="4" fill="#8d5a3b" />
          <rect x="30" y="26" width="10" height="9" rx="4" fill="#ffc93c" />
          <circle cx="48" cy="16" r="2" fill="#555" />
          <circle cx="48" cy="23" r="2" fill="#555" />
          <rect x="21" y="40" width="20" height="4" fill="#d9d4c7" />
        </>
      );
      break;
    case 'todo':
      body = (
        <>
          <rect width="62" height="50" fill={BG} />
          <rect x="6" y="14" width="23" height="22" rx="4" fill="#0f6b2f" />
          <rect x="6" y="12" width="23" height="20" rx="4" fill="#2fd06a" />
          <rect x="33" y="14" width="23" height="22" rx="4" fill="#7a1a12" />
          <rect x="33" y="12" width="23" height="20" rx="4" fill="#ff4a3a" />
          <path d="m12 22 4 4 7-8" stroke="#052" strokeWidth="2.6" fill="none" />
        </>
      );
      break;
    case 'p1':
    case 'p2': {
      const [dark, light] = k === 'p1' ? ['#c99a12', '#ffc93c'] : ['#c2468e', '#ff6fc1'];
      body = (
        <>
          <rect width="62" height="50" fill={BG} />
          <path d="M8 13h17l4 4h25v24H8z" fill={dark} />
          <rect x="8" y="19" width="46" height="23" rx="2" fill={light} />
          <rect x="13" y="25" width="18" height="3" fill="#141414" opacity=".5" />
        </>
      );
      break;
    }
    case 'future':
      body = (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1d1d8f" />
              <stop offset="1" stopColor="#4c6bff" />
            </linearGradient>
          </defs>
          <rect width="62" height="50" fill={`url(#${gid})`} />
          <circle cx="31" cy="36" r="13" fill="#ffc93c" />
          <rect y="34" width="62" height="16" fill="#141414" />
          {keys.map((i) => (
            <rect key={i} x="0" y={37 + i * 3.4} width="62" height="1.2" fill="#ff6fc1" opacity={0.9 - i * 0.2} />
          ))}
        </>
      );
      break;
    case 'timer':
      // A stopwatch: cream face, green elapsed sector, red hand.
      body = (
        <>
          <rect width="62" height="50" fill={BG} />
          <rect x="28" y="4" width="6" height="5" rx="1.5" fill="#bbb" />
          <rect x="42" y="8" width="5" height="4" rx="1.5" fill="#888" transform="rotate(40 44.5 10)" />
          <circle cx="31" cy="28" r="16" fill="#f4f1ea" />
          <path d="M31 28 L31 14 A14 14 0 0 1 44.3 23.7 Z" fill="#62ff8d" />
          <circle cx="31" cy="28" r="16" fill="none" stroke="#2fd06a" strokeWidth="2.5" />
          <line x1="31" y1="28" x2="38.5" y2="19.5" stroke="#ff4a3a" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="31" cy="28" r="2.2" fill="#141414" />
        </>
      );
      break;
    case 'activity':
      // A little GitHub-style contribution grid in greens.
      body = (
        <>
          <rect width="62" height="50" fill={BG} />
          {[0, 1, 2, 3, 4, 5, 6].map((c) =>
            [0, 1, 2, 3, 4].map((r) => (
              <rect
                key={c + '-' + r}
                x={4 + c * 8}
                y={6 + r * 8}
                width="6"
                height="6"
                rx="1.2"
                fill={['#26302a', '#0f6b2f', '#1c9a48', '#2fd06a', '#62ff8d'][(c * 3 + r * 5 + c * r) % 5]}
              />
            )),
          )}
        </>
      );
      break;
    case 'alarms':
      // A twin-bell alarm clock: yellow bells, red case, cream face.
      body = (
        <>
          <rect width="62" height="50" fill="#2b2b2b" />
          <circle cx="19" cy="11" r="6" fill="#ffc93c" />
          <circle cx="43" cy="11" r="6" fill="#ffc93c" />
          <rect x="18" y="41" width="4" height="6" rx="1.5" fill="#ff4a3a" transform="rotate(25 20 44)" />
          <rect x="40" y="41" width="4" height="6" rx="1.5" fill="#ff4a3a" transform="rotate(-25 42 44)" />
          <circle cx="31" cy="27" r="16" fill="#ff4a3a" />
          <circle cx="31" cy="27" r="12.5" fill="#fff8e1" />
          <line x1="31" y1="27" x2="31" y2="18.5" stroke="#141414" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="31" y1="27" x2="37" y2="30.5" stroke="#141414" strokeWidth="2" strokeLinecap="round" />
          <circle cx="31" cy="27" r="1.8" fill="#141414" />
        </>
      );
      break;
    case 'notes':
      // A spiral notebook with a pink cover band and ruled lines.
      body = (
        <>
          <rect width="62" height="50" fill="#2b2b2b" />
          <rect x="14" y="6" width="34" height="40" rx="3" fill="#fff8e1" />
          <rect x="14" y="6" width="34" height="9" rx="3" fill="#ff6fc1" />
          <rect x="14" y="11" width="34" height="4" fill="#ff6fc1" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="19" y={20 + i * 6} width={i === 3 ? 14 : 24} height="2" rx="1" fill="#c9c2ae" />
          ))}
          {[18, 24, 30, 36, 42].map((x) => (
            <circle key={x} cx={x} cy="6" r="1.8" fill="#141414" />
          ))}
        </>
      );
      break;
    case 'chat':
      body = (
        <>
          <rect width="62" height="50" fill="#0b0b0b" />
          <rect x="7" y="8" width="34" height="13" rx="6" fill="#262626" />
          <rect x="21" y="25" width="34" height="13" rx="6" fill="#62ff8d" />
          <rect x="12" y="13" width="18" height="3" rx="1.5" fill="#888" />
          <rect x="26" y="30" width="22" height="3" rx="1.5" fill="#063" />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 62 50" aria-hidden="true" style={style}>
      {body}
    </svg>
  );
}
