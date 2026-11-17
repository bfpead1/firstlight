// The AI daily plan (generated server-side with Groq). Loading the page only reads the saved
// plan; Groq is called by the morning job or when you press Generate/Regenerate.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getJson, sendJson } from "./api";

export type BlockType = "class" | "task" | "workout" | "study" | "break";

export type TaskSize = "quick" | "medium" | "long";

export type PlanTask = {
  id: string;
  key: string;
  title: string;
  source: "email" | "canvas" | "workout" | "scripture";
  source_id: string | null;
  due: string | null;
  size: TaskSize;
  /** "ai": sized by the model; "you": your correction; "plan": a known duration (workout, study). */
  size_source: "ai" | "you" | "plan";
  note: string;
  missing?: boolean;
  course?: string | null;
  url?: string | null;
  minutes?: number;
  done?: boolean;
};

export type PlanFailure = { at: string; code: string; message: string };

export type DailyPlan = {
  date: string;
  generatedAt: string;
  /** Set when the last generation attempt failed after this plan was made. */
  failure?: PlanFailure | null;
  plan: {
    version: 2;
    free_blocks: { start: string; end: string; minutes: number; items: { task_id: string; part: number; parts: number }[] }[];
    unscheduled: string[];
    tasks: Record<string, PlanTask>;
    order: string[];
    priorities: { task_id: string; title: string; reason: string; size: TaskSize }[];
    time_blocks: { start: string; end: string; label: string; type: BlockType }[];
    email_actions: { email_id: string; suggestion: string; subject: string | null; from: string | null }[];
    triage_counts: { action: number; fyi: number; ignore: number };
    note: string;
    generated_at?: string;
    warnings: string[];
    source: { fallback: boolean; calls: { task: string; provider: string; model: string; fallback: boolean; cached: boolean }[] };
  };
};

export const sizeLabels: Record<TaskSize, string> = { quick: "Quick", medium: "Medium", long: "Long" };

const planKey = ["plan", "today"];

/** Today's plan (null until one exists) and the last failed generation, if it's newer. */
export type PlanState = { plan: DailyPlan | null; failure: PlanFailure | null };

async function fetchPlanState(): Promise<PlanState> {
  try {
    // ensure=1: the server generates today's plan if the morning job missed it.
    const plan = await getJson<DailyPlan>("/api/plan/today?ensure=1");
    return { plan, failure: plan.failure ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { plan: null, failure: (err.body.failure as PlanFailure | null) ?? null };
    }
    throw err;
  }
}

/** Plan plus failure, for the Plan page. */
export function usePlanState() {
  return useQuery({ queryKey: planKey, queryFn: fetchPlanState, retry: false });
}

/** Today's saved plan, or null if none has been generated yet. */
export function useTodayPlan() {
  return useQuery({ queryKey: planKey, queryFn: fetchPlanState, retry: false, select: (s) => s.plan });
}

/** Generates (or regenerates) today's plan. Usually 10–30 seconds; up to about 90 on a heavy day. */
export function useGeneratePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<DailyPlan>("/api/plan/generate", "POST"),
    onSuccess: (plan) => queryClient.setQueryData<PlanState>(planKey, { plan, failure: null }),
    // The server recorded the failure; refetch so the page shows it next to the old plan.
    onError: () => queryClient.invalidateQueries({ queryKey: planKey }),
  });
}

function usePlanEdit<TVars>(fn: (vars: TVars) => Promise<DailyPlan>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (plan) =>
      queryClient.setQueryData<PlanState>(planKey, (prev) => ({ plan, failure: prev?.failure ?? null })),
  });
}

/** Checks a task off, or back on. */
export function useSetTaskDone() {
  return usePlanEdit(({ taskId, done }: { taskId: string; done: boolean }) =>
    sendJson<DailyPlan>(`/api/plan/tasks/${encodeURIComponent(taskId)}/done`, "PUT", { done }),
  );
}

/** Corrects a task's size; remembered for that task on later days, and today is refitted. */
export function useSetTaskSize() {
  return usePlanEdit(({ taskId, size }: { taskId: string; size: TaskSize }) =>
    sendJson<DailyPlan>(`/api/plan/tasks/${encodeURIComponent(taskId)}/size`, "PUT", { size }),
  );
}

/** "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (local) -> "Due today, 11:59 PM", "Due Wed", "Overdue: Mon". */
export function formatTaskDue(due: string, now = new Date()) {
  const [datePart, timePart] = due.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const when = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((when.getTime() - today.getTime()) / 86_400_000);
  const time = timePart ? formatClock(timePart) : null;
  const dayLabel =
    days === 0 ? "today" : days === 1 ? "tomorrow" : days > 1 && days < 7
      ? when.toLocaleDateString(undefined, { weekday: "short" })
      : when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const overdue = days < 0 || (days === 0 && timePart && formatMinutes(timePart) < now.getHours() * 60 + now.getMinutes());
  return {
    label: overdue ? `Overdue · ${dayLabel}` : `Due ${dayLabel}${time ? `, ${time}` : ""}`,
    urgent: overdue || days <= 1,
    overdue: Boolean(overdue),
  };
}

function formatMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 125 -> "2 h 5 min" */
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** "13:30" -> "1:30 PM" */
export function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** User-facing explanation for a failed AI request. */
export function aiMessage(error: Error | null, fallback = "Couldn't generate your plan right now.") {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "ai_not_configured") return "Add a free Groq API key as GROQ_API_KEY in backend/.env to turn on AI planning.";
  if (code === "ai_bad_key") return "Groq rejected the API key. Check GROQ_API_KEY in backend/.env.";
  if (code === "ai_rate_limited") {
    const wait = error instanceof ApiError ? error.retryAfter : null;
    return `Groq's free-tier limit was reached. Try again ${wait ? `in about ${formatWait(wait)}` : "in a minute"}.`;
  }
  if (code === "ai_invalid_output") return `${fallback} The AI's answer didn't pass the checks, even after a retry.`;
  if (code === "google_reauth_required") return "Google access expired. Reconnect in Settings.";
  return fallback;
}

function formatWait(seconds: number) {
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`;
}
