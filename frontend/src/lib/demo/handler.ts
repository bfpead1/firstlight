// The guest-mode stand-in for the backend. It answers the same /api routes with the same
// shapes, keeps the guest's changes in sessionStorage for this tab, and never calls the
// server, Google, Canvas or an AI provider. Loaded only in guest mode (see lib/guest.ts).
import { localDateString } from "../api";
import type { CalendarEvent, EmailSummary, EventInput } from "../google";
import { exitGuest } from "../guest";
import type { BlockType, DailyPlan, PlanTask, TaskSize } from "../plan";
import type { ScriptureProgress } from "../scripture";
import type { AiStatus, Settings } from "../settings";
import {
  type ActivePlan,
  type BodyMetric,
  type GenerateRequest,
  type Suggestion,
  todaysWorkout,
  type WorkoutLog,
} from "../workout";
import {
  GUEST_USER,
  SAMPLE_CANVAS_STATUS,
  SAMPLE_EMAIL_ACTIONS,
  SAMPLE_EMAILS,
  SAMPLE_TASKS,
  SAMPLE_WORKOUT_PLAN,
  sampleCoursework,
  sampleEvents,
  sampleLogs,
  sampleMetrics,
  sampleProgress,
  sampleSettings,
} from "./sampleData";

type DemoState = {
  /** The day the sample data was made for; a new day starts fresh. */
  day: string;
  nextId: number;
  settings: Omit<Settings, "features">;
  events: CalendarEvent[];
  emails: EmailSummary[];
  canvasConnected: boolean;
  workout: ActivePlan;
  metrics: BodyMetric[];
  logs: WorkoutLog[];
  suggestion: Suggestion | null;
  progress: ScriptureProgress;
  plan: DailyPlan | null;
  taskSizes: Record<string, TaskSize>;
};

const STATE_KEY = "firstlight_guest_state";
const FEATURES: Settings["features"] = { ai: true, database: "json" };

let memory: DemoState | null = null;

function freshState(): DemoState {
  const state: DemoState = {
    day: localDateString(),
    nextId: 1,
    settings: sampleSettings(),
    events: sampleEvents(),
    emails: SAMPLE_EMAILS,
    canvasConnected: true,
    workout: { plan: SAMPLE_WORKOUT_PLAN, source: "default", summary: null, updatedAt: null },
    metrics: sampleMetrics(),
    logs: sampleLogs(SAMPLE_WORKOUT_PLAN),
    suggestion: null,
    progress: sampleProgress(),
    plan: null,
    taskSizes: {},
  };
  state.plan = buildPlan(state);
  return state;
}

function load(): DemoState {
  if (memory?.day === localDateString()) return memory;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null") as DemoState | null;
    memory = saved?.day === localDateString() ? saved : freshState();
  } catch {
    memory = freshState();
  }
  return memory;
}

function save(state: DemoState) {
  memory = state;
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: changes still last until the page reloads.
  }
}

function clearState() {
  memory = null;
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ─── Responses ─────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });
const notFound = () => json({ error: "not_found" }, 404);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Daily plan (same free-time fitting as backend/src/plan/freeTime.js) ───

const SIZE_MINUTES: Record<TaskSize, number> = { quick: 20, medium: 60, long: 120 };
const sizeForMinutes = (m: number): TaskSize => (m <= 30 ? "quick" : m <= 90 ? "medium" : "long");
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const localHHMM = (iso: string) => {
  const d = new Date(iso);
  return toHHMM(d.getHours() * 60 + d.getMinutes());
};

type Block = { start: string; end: string; minutes: number };
type FittedBlock = DailyPlan["plan"]["free_blocks"][number];

function freeBlocks(events: { start: string; end: string }[], dayStart = "07:00", dayEnd = "22:00", bufferMin = 5, minBlock = 20) {
  let cursor = toMinutes(dayStart);
  const end = toMinutes(dayEnd);
  const busy = events
    .map((e) => [toMinutes(e.start), Math.min(toMinutes(e.end) + bufferMin, 24 * 60)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const blocks: Block[] = [];
  const push = (s: number, e: number) => {
    if (e - s >= minBlock) blocks.push({ start: toHHMM(s), end: toHHMM(e), minutes: e - s });
  };
  for (const [s, e] of busy) {
    if (s >= end) break;
    if (s > cursor) push(cursor, Math.min(s, end));
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) push(cursor, end);
  return blocks;
}

function fitTasks(blocks: Block[], tasks: PlanTask[], minChunk = 20) {
  const out = blocks.map((b) => ({ ...b, items: [] as FittedBlock["items"], left: b.minutes }));
  const unscheduled: string[] = [];
  for (const task of tasks) {
    const need = task.minutes ?? SIZE_MINUTES[task.size];
    const whole = out.find((b) => b.left >= need);
    if (whole) {
      whole.items.push({ task_id: task.id, part: 1, parts: 1 });
      whole.left -= need;
      continue;
    }
    const usable = out.filter((b) => b.left >= minChunk);
    if (task.size !== "long" || usable.reduce((n, b) => n + b.left, 0) < need) {
      unscheduled.push(task.id);
      continue;
    }
    let remaining = need;
    const chunks: [(typeof out)[number], number][] = [];
    for (const b of usable) {
      if (remaining <= 0) break;
      const take = Math.min(b.left, remaining);
      chunks.push([b, take]);
      remaining -= take;
    }
    chunks.forEach(([b, take], i) => {
      b.items.push({ task_id: task.id, part: i + 1, parts: chunks.length });
      b.left -= take;
    });
  }
  return { blocks: out.map(({ left: _left, ...b }) => b), unscheduled };
}

const blockType = (title: string): BlockType =>
  /workout|gym|run|swim|hike/i.test(title)
    ? "workout"
    : /scripture|study session/i.test(title)
      ? "study"
      : /lecture|class|lab|seminar/i.test(title)
        ? "class"
        : "task";

/** Today's plan from the guest's calendar, sample inbox and Canvas work. Keeps check-offs. */
function buildPlan(state: DemoState): DailyPlan {
  const today = localDateString();
  const timed = state.events
    .filter((e) => !e.allDay && localDateString(new Date(e.start)) === today)
    .map((e) => ({
      start: localHHMM(e.start),
      end: localDateString(new Date(e.end)) === today ? localHHMM(e.end) : "23:59",
      title: e.title,
    }));

  const previous = state.plan ? Object.values(state.plan.plan.tasks) : [];
  const wasDone = new Set(previous.filter((t) => t.done).map((t) => t.key));

  const tasks: PlanTask[] = [];
  const add = (t: Omit<PlanTask, "id">) => {
    const task: PlanTask = { ...t, id: `t${tasks.length + 1}` };
    const remembered = state.taskSizes[task.key];
    if (remembered && !task.minutes) {
      task.size = remembered;
      task.size_source = "you";
    }
    if (wasDone.has(task.key)) task.done = true;
    tasks.push(task);
  };

  const reasons = new Map<string, string>();
  for (const t of SAMPLE_TASKS) {
    if (t.source === "canvas" && !state.canvasConnected) continue;
    add({
      key: t.key,
      title: t.title,
      source: t.source,
      source_id: t.source_id,
      due: t.due,
      size: t.size,
      size_source: "ai",
      note: t.note,
      missing: t.missing ?? false,
      course: t.course ?? null,
      url: null,
    });
    if (t.reason) reasons.set(tasks.at(-1)!.id, t.reason);
  }

  const { day } = todaysWorkout(state.workout.plan, state.settings.workoutCycleStart, state.settings.workoutOverride);
  if (day && day.type !== "rest") {
    add({
      key: `workout:${day.title}`,
      title: day.title,
      source: "workout",
      source_id: null,
      due: null,
      size: sizeForMinutes(day.durationMinutes),
      size_source: "plan",
      minutes: day.durationMinutes,
      note: "",
    });
  }
  const scriptureMinutes = state.settings.scripturePace.minutesPerSession;
  add({
    key: "scripture",
    title: "Scripture study",
    source: "scripture",
    source_id: null,
    due: null,
    size: sizeForMinutes(scriptureMinutes),
    size_source: "plan",
    minutes: scriptureMinutes,
    note: "",
  });

  // Scripture first thing, then the sample priorities, then everything else.
  const scripture = tasks.find((t) => t.source === "scripture")!;
  const order = [scripture.id, ...tasks.filter((t) => t !== scripture).map((t) => t.id)];
  const fitted = fitTasks(freeBlocks(timed), order.map((id) => tasks.find((t) => t.id === id)!));
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const priorities = [...reasons].map(([id, reason]) => ({ task_id: id, title: byId[id].title, reason, size: byId[id].size }));
  if (day && day.type !== "rest") {
    const workout = tasks.find((t) => t.source === "workout")!;
    priorities.push({ task_id: workout.id, title: workout.title, reason: "Today's scheduled workout keeps your week on track.", size: workout.size });
  }

  const generatedAt = new Date().toISOString();
  const emailById = new Map(state.emails.map((e) => [e.id, e]));
  return {
    date: today,
    generatedAt,
    failure: null,
    plan: {
      version: 2,
      free_blocks: fitted.blocks,
      unscheduled: fitted.unscheduled,
      tasks: byId,
      order,
      priorities,
      time_blocks: [
        ...timed.map((e) => ({ start: e.start, end: e.end, label: e.title, type: blockType(e.title) })),
        ...fitted.blocks.map((b) => ({ start: b.start, end: b.end, label: "Free time", type: "break" as const })),
      ].sort((a, b) => a.start.localeCompare(b.start)),
      email_actions: SAMPLE_EMAIL_ACTIONS.map((a) => ({
        ...a,
        subject: emailById.get(a.email_id)?.subject ?? null,
        from: emailById.get(a.email_id)?.from ?? null,
      })),
      triage_counts: { action: 2, fyi: 2, ignore: 1 },
      note: "A full day: the problem set and Maya's slides come first, then fit the essay into the long evening gap if you can.",
      generated_at: generatedAt,
      warnings: [],
      source: { fallback: false, calls: [{ task: "plan", provider: "sample data", model: "guest mode", fallback: false, cached: false }] },
    },
  };
}

/** Refit after a size change, with the same free time and order. */
function refit(plan: DailyPlan) {
  const p = plan.plan;
  const blocks = p.free_blocks.map(({ start, end, minutes }) => ({ start, end, minutes }));
  const fitted = fitTasks(blocks, p.order.map((id) => p.tasks[id]));
  p.free_blocks = fitted.blocks;
  p.unscheduled = fitted.unscheduled;
  p.priorities = p.priorities.map((x) => ({ ...x, size: p.tasks[x.task_id].size }));
}

// ─── Workout suggestions (canned, so no AI provider is called) ─────────────

function sampleSuggestion(state: DemoState, req: GenerateRequest): Suggestion | null {
  const plan = structuredClone(state.workout.plan);
  const notes = req.notes.trim();
  const base = {
    id: `sug-${state.nextId++}`,
    request: notes || null,
    status: "pending" as const,
    createdAt: new Date().toISOString(),
  };
  if (req.mode === "edit_day") {
    const day = plan.weeks[req.weekIndex]?.days.find((d) => d.weekday === req.weekday);
    if (!day) return null;
    if (day.type === "rest") {
      day.title = "Mobility & Stretching";
      day.type = "strength";
      day.durationMinutes = 20;
      day.sections = [];
    }
    day.sections.push({
      title: "Finisher",
      kind: "exercises",
      items: [
        { name: "Farmer's Carry", detail: "Grip and core", amount: "3 × 40 yd", swap: false },
        { name: "Hip Flexor Stretch", detail: "Hold each side", amount: "2 × 45 sec", swap: false },
      ],
    });
    day.durationMinutes += 10;
    day.note = notes ? `Adjusted for: ${notes}` : day.note;
    return {
      ...base,
      kind: "edit_day",
      target: { weekIndex: req.weekIndex, weekday: req.weekday },
      summary: `Added a short finisher to ${day.title}. This is a sample suggestion: with an account, the AI rewrites the day from your goals, notes and recent check-offs.`,
      changes: [
        { change: "Added farmer's carries", why: "Builds grip and core strength with little extra time." },
        { change: "Added a hip flexor stretch", why: "Helps recovery after a long day of sitting." },
      ],
      plan,
    };
  }
  plan.name = "New Training Week";
  for (const day of plan.weeks[0].days) if (day.note === null && day.type !== "rest") day.note = "Rest 60–90 seconds between sets.";
  return {
    ...base,
    kind: "new_plan",
    target: null,
    summary: "A balanced week of strength, cardio and a long outdoor day. This is a sample plan: with an account, the AI designs one around your goals, equipment and history.",
    changes: [],
    plan,
  };
}

// ─── Router ────────────────────────────────────────────────────────────────

async function readBody(init?: RequestInit) {
  if (typeof init?.body !== "string") return {};
  try {
    return JSON.parse(init.body);
  } catch {
    return {};
  }
}

export async function handleDemoRequest(url: string, init?: RequestInit): Promise<Response> {
  const { pathname, searchParams } = new URL(url, window.location.origin);
  const path = pathname.replace(/^\/api/, "");
  const method = (init?.method ?? "GET").toUpperCase();
  const body = await readBody(init);
  const route = `${method} ${path}`;
  let m: RegExpMatchArray | null;

  // Auth
  if (route === "GET /auth/me") return json(GUEST_USER);
  if (route === "POST /auth/logout" || route === "POST /auth/disconnect") {
    exitGuest();
    clearState();
    return noContent();
  }

  const state = load();
  const done = (response: Response) => {
    save(state);
    return response;
  };

  // Settings
  if (route === "GET /settings") return json({ ...state.settings, features: FEATURES });
  if (route === "PATCH /settings") {
    state.settings = { ...state.settings, ...body };
    return done(json({ ...state.settings, features: FEATURES }));
  }
  if (route === "GET /settings/ai") {
    const sample = [{ provider: "sample data", model: "guest mode, no AI calls", configured: true, available: true, note: null }];
    const status: AiStatus = {
      tasks: { triage: sample, extract: sample, plan: sample, workout: sample },
      today: { calls: 0, cached: 0, fallbacks: 0, rateLimited: 0, failures: 0, tokens: {} },
    };
    return json(status);
  }

  // Google Calendar & Gmail
  if (route === "GET /google/calendar/today") {
    const start = new Date(searchParams.get("start") ?? 0).getTime();
    const end = new Date(searchParams.get("end") ?? 0).getTime();
    const events = state.events
      .filter((e) => {
        const s = e.allDay ? new Date(`${e.start}T00:00`).getTime() : new Date(e.start).getTime();
        const f = e.allDay ? new Date(`${e.end}T00:00`).getTime() : new Date(e.end).getTime();
        return s < end && f > start;
      })
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
    return json(events);
  }
  if (route === "POST /google/calendar/events") {
    const input = body as EventInput;
    const event: CalendarEvent = {
      id: `ev-${state.nextId++}`,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      location: input.location,
      description: input.description,
      htmlLink: null,
      editable: true,
      recurring: false,
    };
    state.events.push(event);
    return done(json(event, 201));
  }
  if ((m = path.match(/^\/google\/calendar\/events\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    const i = state.events.findIndex((e) => e.id === id);
    if (i === -1) return notFound();
    if (method === "PATCH") {
      const { timeZone: _tz, ...input } = body as EventInput;
      state.events[i] = { ...state.events[i], ...input };
      return done(json(state.events[i]));
    }
    if (method === "DELETE") {
      state.events.splice(i, 1);
      return done(noContent());
    }
  }
  if (route === "GET /google/gmail/recent") return json(state.emails);

  // Daily plan
  if (route === "GET /plan/today") {
    if (!state.plan) return json({ error: "no_plan", failure: null }, 404);
    return json(state.plan);
  }
  if (route === "POST /plan/generate") {
    await wait(1500);
    state.plan = buildPlan(state);
    return done(json(state.plan));
  }
  if ((m = path.match(/^\/plan\/tasks\/([^/]+)\/(size|done)$/)) && method === "PUT") {
    const task = state.plan?.plan.tasks[decodeURIComponent(m[1])];
    if (!state.plan || !task) return json({ error: "task_not_found" }, 404);
    if (m[2] === "done") {
      task.done = Boolean(body.done);
    } else {
      if (task.minutes) return json({ error: "fixed_duration" }, 400);
      task.size = body.size;
      task.size_source = "you";
      state.taskSizes[task.key] = body.size;
      refit(state.plan);
    }
    return done(json(state.plan));
  }

  // Canvas
  if (route === "GET /canvas/status") return json(state.canvasConnected ? SAMPLE_CANVAS_STATUS : { connected: false });
  if (route === "GET /canvas/upcoming") {
    return state.canvasConnected ? json(sampleCoursework()) : json({ error: "canvas_not_connected" }, 400);
  }
  if (route === "POST /canvas/connect") {
    state.canvasConnected = true;
    return done(json(SAMPLE_CANVAS_STATUS));
  }
  if (route === "DELETE /canvas/connect") {
    state.canvasConnected = false;
    return done(noContent());
  }

  // Scripture
  if (route === "GET /scripture/progress") return json(state.progress);
  if (route === "PUT /scripture/progress") {
    const completedAt = new Date().toISOString();
    for (const { slug, chapter } of body.chapters ?? []) {
      state.progress[slug] ??= {};
      if (body.completed) state.progress[slug][chapter] = { completed: true, completedVia: body.via ?? "manual", completedAt };
      else delete state.progress[slug][chapter];
    }
    return done(json(state.progress));
  }
  if (route === "POST /scripture/progress/import") {
    let imported = 0;
    for (const [slug, chapters] of Object.entries((body ?? {}) as Record<string, Record<string, unknown>>)) {
      for (const [chapter, value] of Object.entries(chapters ?? {})) {
        const completed = typeof value === "boolean" ? value : Boolean((value as { completed?: boolean })?.completed);
        if (!completed) continue;
        state.progress[slug] ??= {};
        state.progress[slug][chapter] = { completed: true, completedVia: "import", completedAt: new Date().toISOString() };
        imported++;
      }
    }
    return done(json({ imported, progress: state.progress }));
  }

  // Workout
  if (route === "GET /workout/plan") return json(state.workout);
  if (route === "POST /workout/plan/reset") {
    state.workout = { plan: SAMPLE_WORKOUT_PLAN, source: "default", summary: null, updatedAt: null };
    return done(json(state.workout));
  }
  if (route === "GET /workout/metrics") return json(state.metrics);
  if (route === "POST /workout/metrics") {
    const metric: BodyMetric = { ...body, id: `metric-${state.nextId++}`, createdAt: new Date().toISOString() };
    state.metrics = [metric, ...state.metrics].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn));
    return done(json(metric, 201));
  }
  if ((m = path.match(/^\/workout\/metrics\/([^/]+)$/)) && method === "DELETE") {
    state.metrics = state.metrics.filter((x) => x.id !== m![1]);
    return done(noContent());
  }
  if (route === "GET /workout/logs") {
    const since = searchParams.get("since") ?? "";
    return json(state.logs.filter((l) => l.date >= since));
  }
  if ((m = path.match(/^\/workout\/logs\/(\d{4}-\d{2}-\d{2})$/)) && method === "PUT") {
    const log: WorkoutLog = { ...body, date: m[1], updatedAt: new Date().toISOString() };
    state.logs = [log, ...state.logs.filter((l) => l.date !== log.date)].sort((a, b) => b.date.localeCompare(a.date));
    return done(json(log));
  }
  if (route === "GET /workout/suggestions/latest") return json(state.suggestion);
  if (route === "POST /workout/generate") {
    await wait(1500);
    const suggestion = sampleSuggestion(state, body as GenerateRequest);
    if (!suggestion) return json({ error: "day_not_found" }, 404);
    state.suggestion = suggestion;
    return done(json(suggestion, 201));
  }
  if ((m = path.match(/^\/workout\/suggestions\/([^/]+)\/(accept|dismiss)$/)) && method === "POST") {
    const suggestion = state.suggestion;
    if (!suggestion || suggestion.id !== m[1]) return notFound();
    state.suggestion = null;
    if (m[2] === "dismiss") return done(noContent());
    state.workout = { plan: suggestion.plan, source: "ai", summary: suggestion.summary, updatedAt: new Date().toISOString() };
    if (suggestion.kind === "new_plan") {
      state.settings = { ...state.settings, workoutCycleStart: sampleSettings().workoutCycleStart, workoutOverride: null };
    }
    return done(json(state.workout));
  }

  return notFound();
}
