import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '@/lib/server/db/connect';
import { getSettings } from '@/lib/server/repo';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-desk-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('local database folder', () => {
  // Creating an on-disk database writes many files — slow on Windows, so allow extra time.
  it('starts even when the parent folder (e.g. ./.data) does not exist yet', { timeout: 60_000 }, async () => {
    const dir = path.join(root, 'missing', 'parent', 'pglite');
    const { db, close } = await openDb('pglite:' + dir, { migrate: true });
    try {
      expect((await getSettings(db)).p1.name).toBe('project one');
      expect(fs.existsSync(dir)).toBe(true);
    } finally {
      await close();
    }
  });
});
