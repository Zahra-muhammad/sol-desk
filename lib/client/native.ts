'use client';

// Native iOS extras, active only inside the Capacitor app (no-ops in a browser or home-screen web app).
import { Capacitor } from '@capacitor/core';
import { upcoming } from '@/lib/shared/alarm';
import { pad } from '@/lib/shared/dates';
import type { Alarm } from '@/lib/shared/types';

export const isNativeApp = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** iOS notification ids are 32-bit ints; derive a stable one from the alarm id. */
function numericId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

let asked = false;

/**
 * Mirror upcoming alarms into iOS local notifications, so they ring even when the app is closed.
 * Called whenever alarms change; replaces whatever was scheduled before. iOS keeps at most 64.
 */
export async function syncNativeAlarms(alarms: Alarm[]) {
  if (!isNativeApp()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'prompt' && !asked) {
    asked = true;
    perm = await LocalNotifications.requestPermissions();
  }
  if (perm.display !== 'granted') return;

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });

  const next = upcoming(alarms).slice(0, 60);
  if (!next.length) return;
  await LocalNotifications.schedule({
    notifications: next.map((a) => {
      const at = new Date(a.at);
      return {
        id: numericId(a.id),
        title: `Alarm · ${pad(at.getHours())}:${pad(at.getMinutes())}`,
        body: a.label || 'Timer',
        schedule: { at, allowWhileIdle: true },
        extra: { alarmId: a.id },
      };
    }),
  });
}
