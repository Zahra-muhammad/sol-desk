import { describe, expect, it } from 'vitest';
import { quickAdd } from '@/lib/shared/quickAdd';

// Tuesday 17 Nov 2026, 10:00 local
const NOW = new Date(2026, 10, 17, 10, 0);

describe('quick add', () => {
  it('“call Ali tomorrow 3pm #1” → meeting tomorrow 15:00 in project one', () => {
    expect(quickAdd('call Ali tomorrow 3pm #1', NOW)).toMatchObject({ type: 'meeting', title: 'call Ali', date: '2026-11-18', time: '15:00', project: 'p1', dur: 30 });
  });

  it('“gym 7am” → event today 07:00', () => {
    expect(quickAdd('gym 7am', NOW)).toMatchObject({ type: 'event', title: 'gym', date: '2026-11-17', time: '07:00', dur: 60 });
  });

  it('“send invoice fri #2” → to-do on Friday in project two', () => {
    expect(quickAdd('send invoice fri #2', NOW)).toMatchObject({ type: 'task', title: 'send invoice', date: '2026-11-20', time: null, project: 'p2' });
  });

  it('understands “next fri”, dd/mm, 15:00 and plain to-dos', () => {
    expect(quickAdd('dentist next fri 15:00', NOW)).toMatchObject({ type: 'event', date: '2026-11-27', time: '15:00' });
    expect(quickAdd('pay rent 1/12', NOW)).toMatchObject({ type: 'task', date: '2026-12-01' });
    expect(quickAdd('water plants', NOW)).toMatchObject({ type: 'task', date: null, time: null, project: null });
    expect(quickAdd('standup 9:30', NOW)).toMatchObject({ type: 'meeting', time: '09:30', date: '2026-11-17' });
  });

  it('does not mistake plain numbers or words for projects or days', () => {
    expect(quickAdd('buy 1 milk', NOW)).toMatchObject({ project: null, title: 'buy 1 milk' });
    expect(quickAdd('fix monitor', NOW)).toMatchObject({ date: null, title: 'fix monitor' });
  });
});
