// Response schemas for every AI feature. Zod checks the structure; the validate*()
// functions check rules a schema can't express. A failed check triggers one retry
// (see generateJson in llmCore.js), then an error.
import { z } from "zod";
import { PlanDaySchema, PlanWeekSchema, validatePlanShape } from "../workout/planSchema.js";

// ─── Daily plan ────────────────────────────────────────────────────────────

const SIZE = z.enum(["quick", "medium", "long"]);

export const TriageSchema = z.object({
  emails: z.array(
    z.object({
      id: z.string(),
      category: z.enum(["action", "fyi", "ignore"]),
      suggestion: z.string().max(300),
    }),
  ),
});

/** Every email classified exactly once, and no unknown ids. */
export function validateTriage(result, { emailIds }) {
  const seen = new Set();
  for (const e of result.emails) {
    if (!emailIds.includes(e.id)) return `id "${e.id}" is not one of the provided emails.`;
    if (seen.has(e.id)) return `id "${e.id}" appears more than once.`;
    seen.add(e.id);
  }
  const missing = emailIds.filter((id) => !seen.has(id));
  if (missing.length) return `Classify every email; missing ids: ${missing.join(", ")}.`;
  return null;
}

const DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

export const ExtractSchema = z.object({
  tasks: z.array(
    z.object({
      source_id: z.string(),
      title: z.string().min(1).max(160),
      due: z.string().nullable(),
      size: SIZE,
      note: z.string().max(300),
    }),
  ),
});

/** Known source ids only, at most 3 tasks per item, valid due dates, and every Canvas item covered. */
export function validateExtract(result, { sourceIds, canvasIds }) {
  const perSource = new Map();
  for (const t of result.tasks) {
    if (!sourceIds.includes(t.source_id)) return `source_id "${t.source_id}" is not one of the provided items.`;
    if (t.due !== null && !DUE.test(t.due)) return `due "${t.due}" must be YYYY-MM-DD, YYYY-MM-DDTHH:MM or null.`;
    perSource.set(t.source_id, (perSource.get(t.source_id) ?? 0) + 1);
  }
  for (const [id, n] of perSource) if (n > 3) return `Give at most 3 tasks for "${id}".`;
  const uncovered = canvasIds.filter((id) => !perSource.has(id));
  if (uncovered.length) return `Every Canvas item needs at least one task; missing: ${uncovered.join(", ")}.`;
  return null;
}

export const PrioritizeSchema = z.object({
  order: z.array(z.string()),
  top: z.array(z.object({ task_id: z.string(), reason: z.string().max(300) })),
  note: z.string().max(600),
});

/** `order` is a permutation of the task ids; `top` is 3-5 of them (fewer if there are fewer tasks). */
export function validatePrioritize(result, { taskIds }) {
  const set = new Set(result.order);
  if (set.size !== result.order.length) return "order lists a task more than once.";
  const unknown = result.order.filter((id) => !taskIds.includes(id));
  if (unknown.length) return `order has unknown ids: ${unknown.join(", ")}.`;
  const missing = taskIds.filter((id) => !set.has(id));
  if (missing.length) return `order must include every task; missing: ${missing.join(", ")}.`;
  const want = Math.min(3, taskIds.length);
  if (result.top.length < want || result.top.length > 5) return `top must have ${want} to 5 tasks (got ${result.top.length}).`;
  for (const t of result.top) if (!taskIds.includes(t.task_id)) return `top has unknown id "${t.task_id}".`;
  return null;
}

// ─── Workout generator ─────────────────────────────────────────────────────

export const EditDayResultSchema = z.object({
  summary: z.string().min(1),
  changes: z.array(z.object({ change: z.string(), why: z.string() })),
  day: PlanDaySchema,
});

export const NewPlanResultSchema = z.object({
  summary: z.string().min(1),
  plan: z.object({
    name: z.string().min(1),
    weeks: z.array(PlanWeekSchema),
  }),
});

export function validateNewPlan(result, { daysPerWeek }) {
  if (result.plan.weeks.length !== 1) return "Return exactly one week.";
  const shape = validatePlanShape(result.plan);
  if (shape) return shape;
  const trainingDays = result.plan.weeks[0].days.filter((d) => d.type !== "rest").length;
  if (trainingDays !== daysPerWeek) {
    return `The week has ${trainingDays} training days but the client asked for ${daysPerWeek}; the other days must be type "rest".`;
  }
  return validateDays(result.plan.weeks[0].days);
}

export function validateEditedDay(result) {
  return validateDays([result.day]);
}

function validateDays(days) {
  for (const d of days) {
    if (d.type === "rest") continue;
    if (!d.sections.length || d.sections.every((s) => !s.items.length)) return `${d.weekday} has no exercises.`;
    if (!(d.durationMinutes >= 10 && d.durationMinutes <= 240)) return `${d.weekday} durationMinutes must be 10–240.`;
  }
  return null;
}
