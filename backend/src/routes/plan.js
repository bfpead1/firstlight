import { Router } from "express";
import { z } from "zod";
import { sendAiError } from "../ai/llm.js";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { isReauthError } from "../lib/google.js";
import { requireUser } from "../lib/requireUser.js";
import { localTime, toMinutes } from "../lib/time.js";
import { generateDailyPlan, isCurrentPlan, todayInAppZone } from "../plan/dailyPlan.js";
import { fitTasks, SIZES } from "../plan/freeTime.js";

export const planRouter = Router();
planRouter.use(requireUser);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// One generation per user at a time, even if the button is pressed twice or the page loads twice.
const inFlight = new Map();
// The last failed generation per user and day, so the page can say so instead of quietly
// showing an older plan. In memory: a restart forgets it, and the next load simply retries.
const failures = new Map();

function generate(user) {
  const key = user.id;
  if (!inFlight.has(key)) {
    const date = todayInAppZone();
    inFlight.set(
      key,
      generateDailyPlan(user, date)
        .then((result) => {
          failures.delete(`${user.id}:${date}`);
          return result;
        })
        .catch((err) => {
          failures.set(`${user.id}:${date}`, {
            at: new Date().toISOString(),
            code: isReauthError(err) ? "google_reauth_required" : (err.code ?? "error"),
            message: isReauthError(err) ? "Google access expired." : err.code ? err.message : "Plan generation failed.",
          });
          throw err;
        })
        .finally(() => inFlight.delete(key)),
    );
  }
  return inFlight.get(key);
}

function sendGenerateError(res, err) {
  if (isReauthError(err)) return res.status(401).json({ error: "google_reauth_required" });
  sendAiError(res, err);
}

/**
 * The saved plan for a day. With ?ensure=1 (the app's first load), today's plan is generated
 * if it doesn't exist yet and the morning job time has passed, as a fallback for a missed job.
 * The response carries `failure` when the last generation attempt failed after this plan was made.
 */
planRouter.get("/today", async (req, res) => {
  const date = dateSchema.safeParse(req.query.date ?? todayInAppZone());
  if (!date.success) return res.status(400).json({ error: "invalid_date" });
  const failure = failures.get(`${req.user.id}:${date.data}`) ?? null;
  let row = await db.briefs.get(req.user.id, date.data);

  if (!isCurrentPlan(row?.brief)) {
    const jobTimePassed = toMinutes(localTime(new Date(), config.timeZone)) >= toMinutes(config.planJobTime);
    const canGenerate = req.query.ensure === "1" && config.aiEnabled && date.data === todayInAppZone() && jobTimePassed;
    // Don't retry on every page load after a failure; the Retry button does that.
    if (!canGenerate || failure) return res.status(404).json({ error: "no_plan", failure });
    try {
      const result = await generate(req.user);
      return res.json({ ...result, failure: null, generatedOnLoad: true });
    } catch (err) {
      return sendGenerateError(res, err);
    }
  }

  const generatedAt = row.brief.generated_at ?? row.createdAt;
  res.json({
    date: date.data,
    plan: row.brief,
    generatedAt,
    failure: failure && new Date(failure.at) > new Date(generatedAt) ? failure : null,
  });
});

/** Generates (or regenerates) today's plan and saves it. */
planRouter.post("/generate", async (req, res) => {
  try {
    res.json(await generate(req.user));
  } catch (err) {
    sendGenerateError(res, err);
  }
});

const SizeSchema = z.object({ size: z.enum(SIZES) });
const MAX_REMEMBERED_SIZES = 300;

/**
 * Corrects one task's size in today's plan, remembers it for that task on later days, and
 * refits the free time in code (no AI call).
 */
planRouter.put("/tasks/:taskId/size", async (req, res) => {
  const body = SizeSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_size" });
  const date = todayInAppZone();
  const row = await db.briefs.get(req.user.id, date);
  const plan = row?.brief;
  const task = isCurrentPlan(plan) ? plan.tasks[req.params.taskId] : null;
  if (!task) return res.status(404).json({ error: "task_not_found" });
  if (task.minutes) return res.status(400).json({ error: "fixed_duration" });

  const settings = await db.settings.get(req.user.id);
  const taskSizes = { ...(settings.taskSizes ?? {}), [task.key]: body.data.size };
  const keys = Object.keys(taskSizes);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_SIZES))) delete taskSizes[k];
  await db.settings.update(req.user.id, { taskSizes });

  task.size = body.data.size;
  task.size_source = "you";
  // Refit with the same free time and order; the blocks' bounds are unchanged.
  const blocks = plan.free_blocks.map(({ start, end, minutes }) => ({ start, end, minutes }));
  const fitted = fitTasks(blocks, plan.order.map((id) => plan.tasks[id]));
  plan.free_blocks = fitted.blocks;
  plan.unscheduled = fitted.unscheduled;
  plan.priorities = plan.priorities.map((p) => ({ ...p, size: plan.tasks[p.task_id].size }));

  const saved = await db.briefs.save(req.user.id, date, plan);
  res.json({ date, plan: saved.brief, generatedAt: plan.generated_at ?? saved.createdAt });
});

const DoneSchema = z.object({ done: z.boolean() });

/** Checks a task off (or back on) in today's plan. */
planRouter.put("/tasks/:taskId/done", async (req, res) => {
  const body = DoneSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_done" });
  const date = todayInAppZone();
  const row = await db.briefs.get(req.user.id, date);
  const plan = row?.brief;
  const task = isCurrentPlan(plan) ? plan.tasks[req.params.taskId] : null;
  if (!task) return res.status(404).json({ error: "task_not_found" });
  task.done = body.data.done;
  const saved = await db.briefs.save(req.user.id, date, plan);
  res.json({ date, plan: saved.brief, generatedAt: plan.generated_at ?? saved.createdAt });
});
