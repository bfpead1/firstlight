// The daily-plan pipeline: free time (code) -> triage (AI) -> fetch bodies/descriptions ->
// extract tasks (AI) -> prioritize (AI) -> fit into free time (code).
//
// Everything external is passed in (`deps`), so tests run it with fake data and a fake LLM.
// Model output is only ever used as suggestions: ids are checked against the data we sent,
// and nothing here sends, edits or deletes anything.
import { AiError, estimateTokens } from "../ai/llmCore.js";
import {
  buildExtractPrompt,
  buildPrioritizePrompt,
  buildTriagePrompt,
  EXTRACT_SYSTEM,
  PRIORITIZE_SYSTEM,
  TRIAGE_SYSTEM,
} from "../ai/prompts.js";
import {
  ExtractSchema,
  PrioritizeSchema,
  TriageSchema,
  validateExtract,
  validatePrioritize,
  validateTriage,
} from "../ai/schemas.js";
import { fitTasks, freeBlocks, sizeForMinutes } from "./freeTime.js";
import { htmlToText, sanitizeUntrusted, trimEmailBody } from "./text.js";

export const LIMITS = {
  snippetChars: 200,
  bodyChars: 2000,
  descriptionChars: 1500,
  maxActionEmails: 6,
  maxCanvasItems: 8,
  canvasDays: 3,
  /** Prompt budget per extraction call; larger inputs are split into several calls. */
  extractPromptTokens: 4500,
  maxTokens: { triage: 2000, extract: 1500, plan: 2000 },
};

const WORKOUT_EVENT = /\b(workout|gym|lift(ing)?|run|swim|hike|training|crossfit|yoga)\b/i;
const SCRIPTURE_EVENT = /\b(scripture|book of mormon|come follow me)\b/i;
const CLASS_EVENT = /\b(class|lecture|lab|section|seminar|recitation|discussion|exam|midterm|final)\b/i;

/** Stable key for remembering a size correction across days. */
export function taskKey(task) {
  if (task.source === "canvas") return `canvas:${task.source_id}`;
  if (task.source === "workout" || task.source === "scripture") return task.source;
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `email:${task.source_id}:${slug}`;
}

/** Splits items into groups whose rendered prompt stays under the extraction budget. */
function chunkForExtraction(items, render) {
  const chunks = [];
  let current = [];
  for (const item of items) {
    const next = [...current, item];
    if (current.length && estimateTokens(render(next)) > LIMITS.extractPromptTokens) {
      chunks.push(current);
      current = [item];
    } else {
      current = next;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * @param input.date, weekday, timeZone, now ("HH:MM" when planning today mid-day, else null)
 * @param input.events     [{ start, end, title }] timed events, local HH:MM
 * @param input.allDay     [title]
 * @param input.emails     [{ id, from, subject, snippet }] or null when Gmail isn't connected
 * @param input.coursework { upcoming, missing } | null | "unavailable"
 * @param input.workout    { title, minutes } | null
 * @param input.scripture  { minutes } | null
 * @param input.sizeMemory { [taskKey]: "quick"|"medium"|"long" } the user's corrections
 * @param deps.generateJson     the LLM client
 * @param deps.fetchEmailBody   (id) => text
 * @param deps.fetchDescription (item) => html | null
 * @param deps.log              (message) => void, counts only
 */
export async function buildDailyPlan(input, deps) {
  const log = deps.log ?? (() => {});
  const warnings = [];
  const calls = [];
  const record = (meta, task) => meta && calls.push({ task, provider: meta.provider, model: meta.model, fallback: meta.fallback, cached: meta.cached });

  // ── 1. Free time, from the calendar ──
  const blocks = freeBlocks({ events: input.events, notBefore: input.now });

  // ── 2. Triage emails on snippets ──
  const emails = (input.emails ?? []).map((e) => ({
    id: e.id,
    from: sanitizeUntrusted(e.from, 120),
    subject: sanitizeUntrusted(e.subject, 200),
    snippet: sanitizeUntrusted(e.snippet, LIMITS.snippetChars),
  }));
  let triage = [];
  if (emails.length) {
    try {
      const { data, meta } = await deps.generateJson({
        task: "triage",
        name: "email_triage",
        system: TRIAGE_SYSTEM,
        user: buildTriagePrompt(emails),
        schema: TriageSchema,
        validate: (r) => validateTriage(r, { emailIds: emails.map((e) => e.id) }),
        maxTokens: LIMITS.maxTokens.triage,
      });
      record(meta, "triage");
      triage = data.emails;
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      warnings.push("Couldn't sort your emails this time, so email tasks are missing from this plan.");
      log(`triage failed: ${err.code}`);
    }
  }
  const byEmailId = new Map(emails.map((e) => [e.id, e]));
  const actionEmails = triage.filter((t) => t.category === "action").slice(0, LIMITS.maxActionEmails);

  // ── 3. Bodies for action emails only, descriptions for Canvas work due soon ──
  const emailItems = [];
  for (const t of actionEmails) {
    const e = byEmailId.get(t.id);
    let body = e.snippet;
    try {
      body = sanitizeUntrusted(trimEmailBody(await deps.fetchEmailBody(t.id)), LIMITS.bodyChars) || e.snippet;
    } catch (err) {
      log(`email body unavailable (${err.status ?? err.code ?? "error"}); using the snippet`);
    }
    emailItems.push({ id: `email-${t.id}`, emailId: t.id, from: e.from, subject: e.subject, body });
  }

  const coursework = input.coursework && input.coursework !== "unavailable" ? input.coursework : null;
  if (input.coursework === "unavailable") warnings.push("Canvas couldn't be reached, so coursework may be missing.");
  const soon = new Date(`${input.date}T00:00:00Z`).getTime() + (LIMITS.canvasDays + 1) * 24 * 60 * 60 * 1000;
  const canvasRaw = coursework
    ? [
        ...coursework.missing.map((i) => ({ ...i, missing: true })),
        ...coursework.upcoming.filter((i) => !i.done && i.dueAt && new Date(i.dueAt).getTime() < soon),
      ].slice(0, LIMITS.maxCanvasItems)
    : [];
  const canvasItems = [];
  for (const item of canvasRaw) {
    let description = "";
    try {
      description = sanitizeUntrusted(htmlToText((await deps.fetchDescription(item)) ?? ""), LIMITS.descriptionChars);
    } catch (err) {
      log(`canvas description unavailable (${err.code ?? "error"})`);
    }
    canvasItems.push({
      id: `canvas-${item.id}`,
      canvasId: item.id,
      title: sanitizeUntrusted(item.title, 200),
      course: sanitizeUntrusted(item.course ?? "", 120) || null,
      due: item.dueAt ? localDue(item.dueAt, input.timeZone) : null,
      points: item.points ?? null,
      missing: Boolean(item.missing),
      url: item.url ?? null,
      description,
    });
  }

  // ── 4. Extract tasks (split into several calls if the input is large) ──
  const extracted = [];
  const allItems = [...emailItems.map((e) => ({ kind: "email", ...e })), ...canvasItems.map((c) => ({ kind: "canvas", ...c }))];
  const render = (items) =>
    buildExtractPrompt({
      today: input.date,
      timeZone: input.timeZone,
      emails: items.filter((i) => i.kind === "email"),
      canvas: items.filter((i) => i.kind === "canvas"),
    });
  const chunks = allItems.length ? chunkForExtraction(allItems, render) : [];
  for (const chunk of chunks) {
    try {
      const { data, meta } = await deps.generateJson({
        task: "extract",
        name: "task_extraction",
        system: EXTRACT_SYSTEM,
        user: render(chunk),
        schema: ExtractSchema,
        validate: (r) =>
          validateExtract(r, {
            sourceIds: chunk.map((i) => i.id),
            canvasIds: chunk.filter((i) => i.kind === "canvas").map((i) => i.id),
          }),
        maxTokens: LIMITS.maxTokens.extract,
      });
      record(meta, "extract");
      extracted.push(...data.tasks);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      log(`extraction failed: ${err.code}`);
      warnings.push("Couldn't read some emails or assignments in detail; those tasks use their titles and a medium size.");
      // Plain fallback so coursework and action emails still appear.
      for (const i of chunk) {
        extracted.push({
          source_id: i.id,
          title: i.kind === "canvas" ? i.title : `Reply: ${i.subject}`,
          due: i.kind === "canvas" ? i.due : null,
          size: "medium",
          note: "",
        });
      }
    }
  }

  // ── 5. Build the task list, applying the user's size corrections ──
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  const tasks = [];
  const add = (t) => {
    const task = { id: `t${tasks.length + 1}`, ...t };
    task.key = taskKey(task);
    const remembered = input.sizeMemory?.[task.key];
    if (remembered && !task.minutes) {
      task.size = remembered;
      task.size_source = "you";
    }
    tasks.push(task);
  };
  for (const t of extracted) {
    const item = itemById.get(t.source_id);
    add({
      title: sanitizeUntrusted(t.title, 160),
      source: item.kind,
      source_id: item.kind === "canvas" ? item.canvasId : item.emailId,
      // Canvas due dates come from Canvas, not the model.
      due: item.kind === "canvas" ? item.due : t.due,
      size: t.size,
      size_source: "ai",
      note: sanitizeUntrusted(t.note, 300),
      missing: item.kind === "canvas" ? item.missing : false,
      course: item.kind === "canvas" ? item.course : null,
      url: item.kind === "canvas" ? item.url : null,
    });
  }
  const hasEvent = (re) => input.events.some((e) => re.test(e.title ?? ""));
  if (input.workout && !hasEvent(WORKOUT_EVENT)) {
    add({ title: input.workout.title, source: "workout", source_id: null, due: null, size: sizeForMinutes(input.workout.minutes), size_source: "plan", minutes: input.workout.minutes, note: "" });
  }
  if (input.scripture?.minutes && !hasEvent(SCRIPTURE_EVENT)) {
    add({ title: "Scripture study", source: "scripture", source_id: null, due: null, size: sizeForMinutes(input.scripture.minutes), size_source: "plan", minutes: input.scripture.minutes, note: "" });
  }

  // ── 6. Prioritize (the one call whose failure fails the plan) ──
  let order = [];
  let top = [];
  let note = "";
  if (tasks.length) {
    const { data, meta } = await deps.generateJson({
      task: "plan",
      name: "prioritized_tasks",
      system: PRIORITIZE_SYSTEM,
      user: buildPrioritizePrompt({
        today: input.date,
        weekday: input.weekday,
        timeZone: input.timeZone,
        blocks,
        allDay: (input.allDay ?? []).map((t) => sanitizeUntrusted(t, 120)),
        tasks: tasks.map(({ id, title, source, due, size, note: n, missing }) => ({ id, title, source, due, size, missing, note: n })),
      }),
      schema: PrioritizeSchema,
      validate: (r) => validatePrioritize(r, { taskIds: tasks.map((t) => t.id) }),
      maxTokens: LIMITS.maxTokens.plan,
    });
    record(meta, "plan");
    order = data.order;
    top = data.top.map((t) => ({ task_id: t.task_id, reason: sanitizeUntrusted(t.reason, 300) }));
    note = sanitizeUntrusted(data.note, 600);
  } else {
    note = "Nothing on your list today beyond your calendar.";
  }

  // ── 7. Fit into free time, in that order (code, not AI) ──
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));
  const fitted = fitTasks(blocks, order.map((id) => byTaskId.get(id)));

  return {
    version: 2,
    free_blocks: fitted.blocks,
    unscheduled: fitted.unscheduled,
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    order,
    priorities: top.map((t) => ({ ...t, title: byTaskId.get(t.task_id).title, size: byTaskId.get(t.task_id).size })),
    email_actions: actionEmails.map((t) => ({
      email_id: t.id,
      suggestion: sanitizeUntrusted(t.suggestion, 300),
      subject: byEmailId.get(t.id)?.subject ?? null,
      from: byEmailId.get(t.id)?.from ?? null,
    })),
    triage_counts: {
      action: triage.filter((t) => t.category === "action").length,
      fyi: triage.filter((t) => t.category === "fyi").length,
      ignore: triage.filter((t) => t.category === "ignore").length,
    },
    // Calendar events and free time for the timeline; no invented times.
    time_blocks: [
      ...input.events.map((e) => ({
        start: e.start,
        end: e.end,
        label: sanitizeUntrusted(e.title, 160),
        type: WORKOUT_EVENT.test(e.title ?? "") ? "workout" : SCRIPTURE_EVENT.test(e.title ?? "") ? "study" : CLASS_EVENT.test(e.title ?? "") ? "class" : "task",
      })),
      ...fitted.blocks.map((b) => ({ start: b.start, end: b.end, label: "Free time", type: "break" })),
    ].sort((a, b) => a.start.localeCompare(b.start)),
    note,
    warnings,
    source: { fallback: calls.some((c) => c.fallback), calls },
  };
}

/** Canvas ISO due time -> "YYYY-MM-DDTHH:MM" in the user's timezone. */
function localDue(iso, timeZone) {
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map(({ type, value }) => [type, value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
