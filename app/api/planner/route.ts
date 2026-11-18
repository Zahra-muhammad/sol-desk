import Anthropic from '@anthropic-ai/sdk';
import { validTimeZone } from '@/lib/shared/alarm';
import { handle, json, requireSession } from '@/lib/server/http';
import { DEFAULT_MODEL, SYSTEM_PROMPT, TIME_ZONE, contextBlock, fallbackParams, plannerWindow } from '@/lib/server/planner';
import { TOOLS, runTool, type ToolOutcome } from '@/lib/server/plannerTools';
import { addChat, getSettings, listChat, liveAlarms, liveEntries, liveNotes, plannerItems } from '@/lib/server/repo';
import { PlannerIn } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 6;

function friendly(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The planner’s API key was rejected. Check ANTHROPIC_API_KEY on the server.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use the planner model.';
  if (err instanceof Anthropic.NotFoundError) return `The model “${model}” isn’t available. Check ANTHROPIC_MODEL.`;
  if (err instanceof Anthropic.RateLimitError) return 'I’m getting a lot of requests — give me a minute and ask again.';
  if (err instanceof Anthropic.BadRequestError) return 'The planner couldn’t handle that request. Try rephrasing it.';
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the planner service. Try again in a moment.';
  if (err instanceof Anthropic.InternalServerError) return 'The planner service is having trouble. Try again in a moment.';
  return 'Something went wrong. Try again in a moment.';
}

/**
 * planner.chat — streams the reply as server-sent events:
 *   {type:'text', text}                 a piece of the reply
 *   {type:'changed', items?, entries?, notes?, alarms?, settings?}
 *                                       records the planner just changed (the desk updates live)
 *   {type:'ui', action, window?}        open/close a window, show desktop, lock
 *   {type:'done', user, assistant}      the saved chat messages
 *   {type:'error', error}
 */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const body = PlannerIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'Type a message first.' }, 400);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'The planner needs an Anthropic API key. Add ANTHROPIC_API_KEY to the server’s environment.' }, 503);
  }

  const { db } = a;
  const message = body.data.message;
  const tz = validTimeZone(body.data.tz) ? body.data.tz : TIME_ZONE;
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const w = plannerWindow(new Date(), tz);
  const settings = await getSettings(db);
  const items = await plannerItems(db, w.day, w.from, w.to);
  const history = await listChat(db, 12);
  const entries = await liveEntries(db, 7);
  const notebook = (await liveNotes(db)).slice(0, 10);
  const alarmList = await liveAlarms(db);

  // History as plain text turns; it must start with a user turn.
  const past: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content || '…' }));
  while (past.length && past[0].role !== 'user') past.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = [...past, { role: 'user', content: message }];
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: contextBlock(items, settings, new Date(), { entries, notes: notebook, alarms: alarmList, tz }) },
  ];

  const client = new Anthropic();
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (ev: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          open = false;
        }
      };
      let text = '';
      let added = 0;
      const did: string[] = [];
      let retries = 0;
      const emit = (t: string) => {
        text += t;
        send({ type: 'text', text: t });
      };
      const apply = (o: ToolOutcome) => {
        if (o.changed) send({ type: 'changed', ...o.changed });
        for (const u of o.ui ?? []) send({ type: 'ui', ...u });
        added += o.added ?? 0;
        did.push(...(o.did ?? []));
      };
      const save = async (content: string) => {
        const u = await addChat(db, 'user', message);
        const asst = await addChat(db, 'assistant', content, added, did.join(' · '));
        send({ type: 'done', user: u, assistant: asst });
      };

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const s = client.beta.messages.stream(
            {
              model,
              max_tokens: 8000,
              system,
              messages,
              tools: TOOLS,
              output_config: { effort: 'low' },
              ...fallbackParams(model),
            },
            { signal: req.signal },
          );
          s.on('text', (delta) => emit(delta));

          let msg: Anthropic.Beta.BetaMessage;
          try {
            msg = await s.finalMessage();
            retries = 0;
          } catch (err) {
            // A tool input that couldn't be parsed or a dropped connection: re-issue the turn (capped).
            // API errors (auth, rate limit, …) are real failures and go straight to the user.
            if (err instanceof Anthropic.APIError || req.signal.aborted || retries++ >= 2) throw err;
            continue;
          }

          if (msg.stop_reason === 'refusal') {
            if (!text.trim()) emit('I can’t help with that one. Try asking about your plans in a different way.');
            break;
          }
          if (msg.stop_reason === 'pause_turn') {
            messages.push({ role: 'assistant', content: msg.content });
            continue;
          }
          const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
          // max_tokens with a tool call means its input may be cut off — never run it.
          if (msg.stop_reason !== 'tool_use' || !uses.length) break;

          messages.push({ role: 'assistant', content: msg.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const u of uses) {
            // Every tool validates its own input before writing anything.
            const o = await runTool(u.name, u.input, { db, tz, now: new Date() });
            apply(o);
            results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(o.result), ...(o.isError ? { is_error: true } : {}) });
          }
          messages.push({ role: 'user', content: results });
          if (text && !text.endsWith('\n')) emit('\n\n');
        }

        await save(text.trim() || (did.length ? 'Done.' : 'I’m not sure what to say to that — could you rephrase?'));
      } catch (err) {
        if (!(err instanceof Anthropic.APIUserAbortError)) console.error('[planner]', err);
        // Whatever the planner already did stays done; record the exchange so the chat shows it.
        if (did.length) await save(text.trim() || 'Done.').catch(() => send({ type: 'error', error: friendly(err, model) }));
        else send({ type: 'error', error: friendly(err, model) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
});
