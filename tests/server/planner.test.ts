import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A scripted stand-in for the Anthropic SDK: each call to beta.messages.stream() plays the next turn.
type Turn = { text?: string; stop: string; content: unknown[] };
const script: Turn[] = [];
const calls: Record<string, unknown>[] = [];

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: new (...a: unknown[]) => object };
  class FakeAnthropic extends actual.default {
    beta = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          const turn = script.shift();
          if (!turn) throw new Error('no scripted turn left');
          const handlers: ((t: string) => void)[] = [];
          return {
            on(ev: string, cb: (t: string) => void) {
              if (ev === 'text') handlers.push(cb);
              return this;
            },
            async finalMessage() {
              if (turn.text) for (const part of turn.text.match(/.{1,8}/gs) ?? []) handlers.forEach((h) => h(part));
              return { id: 'msg_x', type: 'message', role: 'assistant', model: 'm', stop_reason: turn.stop, content: turn.content, usage: {} };
            },
          };
        },
      },
    };
  }
  return { ...actual, default: Object.assign(FakeAnthropic, actual.default) };
});

const { POST: plannerPOST } = await import('@/app/api/planner/route');
const setup = await import('@/app/api/auth/setup/route');
const { getDb } = await import('@/lib/server/db/client');
const schema = await import('@/lib/server/db/schema');
const { patchSettings, pushItems, liveItems } = await import('@/lib/server/repo');
const { makeItem } = await import('../helpers/fixtures');

let cookie = '';
const prevKey = process.env.ANTHROPIC_API_KEY;

function req(body: unknown) {
  return new Request('http://localhost:3000/api/planner', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost:3000', cookie },
    body: JSON.stringify(body),
  });
}

async function events(r: Response) {
  const text = await r.text();
  return text
    .split('\n\n')
    .filter((c) => c.startsWith('data: '))
    .map((c) => JSON.parse(c.slice(6)));
}

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  (globalThis as { __solDb?: unknown }).__solDb = undefined;
  const db = await getDb();
  await db.delete(schema.auth);
  const r = await setup.POST(
    new Request('http://localhost:3000/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({ password: '4821' }),
    }),
  );
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  await patchSettings(db, { p1Name: 'Atlas', p1Notes: 'Launch in December', p2Name: 'Bloom' });
});

afterAll(() => {
  if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
  else delete process.env.ANTHROPIC_API_KEY;
});

beforeEach(() => {
  script.length = 0;
  calls.length = 0;
});

describe('planner.chat API', () => {
  it('streams the reply, adds items when asked, and saves the exchange', async () => {
    const db = await getDb();
    const { shiftDay, zonedParts } = await import('@/lib/shared/dates');
    const fiveDaysAgo = shiftDay(zonedParts(new Date(), 'Asia/Dubai').day, -5);
    await pushItems(db, [
      makeItem({ title: 'Overdue thing', date: fiveDaysAgo }),
      makeItem({ title: 'Ancient thing', date: '2020-01-01' }),
      makeItem({ title: 'Far future', date: '2099-01-01' }),
    ]);
    script.push(
      {
        stop: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'add_items',
            input: { items: [{ type: 'event', title: 'Gym', date: '2026-11-18', time: '07:00', dur: 45, project: '' }] },
          },
        ],
      },
      { text: 'Done — gym is on for tomorrow at 07:00.', stop: 'end_turn', content: [{ type: 'text', text: 'Done — gym is on for tomorrow at 07:00.' }] },
    );

    const r = await plannerPOST(req({ message: 'Add gym tomorrow 7am' }));
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
    const evs = await events(r);

    const added = evs.find((e) => e.type === 'added');
    expect(added.items).toHaveLength(1);
    expect(added.items[0]).toMatchObject({ type: 'event', title: 'Gym', date: '2026-11-18', time: '07:00', dur: 45, project: null });
    const text = evs.filter((e) => e.type === 'text').map((e) => e.text).join('');
    expect(text).toContain('gym is on for tomorrow');
    const done = evs.find((e) => e.type === 'done');
    expect(done.user.content).toBe('Add gym tomorrow 7am');
    expect(done.assistant.addedCount).toBe(1);

    // The item really is in the database.
    expect((await liveItems(db)).map((x) => x.title)).toContain('Gym');

    // Turn 1 carried the system prompt + planner data; turn 2 carried the tool result.
    const sys = (calls[0].system as { text: string }[]).map((s) => s.text).join('\n');
    expect(sys).toMatch(/warm, direct planning coach/);
    expect(sys).toMatch(/Dubai time/);
    expect(sys).toContain('p1 = "Atlas" (notes: Launch in December)');
    expect(sys).toContain('open, OVERDUE | Overdue thing');
    // Outside the window (14 days back → 60 days ahead):
    expect(sys).not.toContain('Ancient thing');
    expect(sys).not.toContain('Far future');
    expect(calls[0].tools).toEqual([expect.objectContaining({ name: 'add_items', eager_input_streaming: true })]);
    const lastMsg = (calls[1].messages as { role: string; content: unknown }[]).at(-1)!;
    expect(lastMsg.role).toBe('user');
    expect(JSON.stringify(lastMsg.content)).toContain('tool_result');
  });

  it('never saves an invalid tool input; tells the model instead', async () => {
    const db = await getDb();
    const before = (await liveItems(db)).length;
    script.push(
      { stop: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_2', name: 'add_items', input: { items: [{ type: 'party', title: '' }] } }] },
      { text: 'Sorry — could you tell me what to add?', stop: 'end_turn', content: [{ type: 'text', text: 'Sorry — could you tell me what to add?' }] },
    );
    const evs = await events(await plannerPOST(req({ message: 'add something' })));
    expect(evs.some((e) => e.type === 'added')).toBe(false);
    expect((await liveItems(db)).length).toBe(before);
    const toolResult = JSON.stringify(calls[1].messages);
    expect(toolResult).toContain('"is_error":true');
    expect(evs.find((e) => e.type === 'done').assistant.addedCount).toBe(0);
  });

  it('handles a refusal gracefully', async () => {
    script.push({ stop: 'refusal', content: [] });
    const evs = await events(await plannerPOST(req({ message: 'something odd' })));
    const done = evs.find((e) => e.type === 'done');
    expect(done.assistant.content).toMatch(/can’t help with that/);
  });

  it('only sends conversation history that starts with a user turn', async () => {
    script.push({ text: 'Hi!', stop: 'end_turn', content: [{ type: 'text', text: 'Hi!' }] });
    await events(await plannerPOST(req({ message: 'hello' })));
    const msgs = calls[0].messages as { role: string }[];
    expect(msgs[0].role).toBe('user');
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'hello' });
  });
});
