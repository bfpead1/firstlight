import { Link } from "react-router-dom";
import { PrimaryButton } from "../components/PrimaryButton";
import { ArrowLeftIcon, ArrowUpRightIcon } from "../components/icons";
import { ApiError } from "../lib/api";
import { useCurrentUser } from "../lib/auth";
import { gmailUrl } from "../lib/google";
import {
  aiMessage,
  type BlockType,
  type DailyPlan,
  formatClock,
  formatDuration,
  formatTaskDue,
  type PlanFailure,
  type PlanTask,
  sizeLabels,
  type TaskSize,
  useGeneratePlan,
  usePlanState,
  useSetTaskDone,
  useSetTaskSize,
} from "../lib/plan";
import { useSettings } from "../lib/settings";

// Calendar events keep the area colours used across the app.
const eventStyles: Record<BlockType, string> = {
  class: "bg-calendar-soft text-calendar",
  task: "bg-card border border-card-border text-ink",
  workout: "bg-workout-soft text-workout",
  study: "bg-scripture-soft text-scripture",
  break: "bg-page text-ink-soft-62",
};

// Each task carries the colour of where it came from.
const sourceStyles: Record<PlanTask["source"], { chip: string; check: string; label: string }> = {
  canvas: { chip: "bg-coursework-soft text-coursework", check: "bg-coursework border-coursework", label: "Canvas" },
  email: { chip: "bg-accent-soft text-accent", check: "bg-accent border-accent", label: "Email" },
  workout: { chip: "bg-workout-soft text-workout", check: "bg-workout border-workout", label: "Workout" },
  scripture: { chip: "bg-scripture-soft text-scripture", check: "bg-scripture border-scripture", label: "Scripture" },
};

const stepLabels: Record<string, string> = {
  triage: "sorting your emails",
  extract: "reading emails and assignments",
  plan: "ranking your tasks",
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function Plan() {
  const settings = useSettings();
  const aiEnabled = settings.data?.features.ai ?? false;
  const state = usePlanState();
  const generate = useGeneratePlan();
  const current = state.data?.plan ?? null;
  const failure = state.data?.failure ?? null;
  const plan = current?.plan;
  const tasks = plan ? Object.values(plan.tasks) : [];
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="px-6 pb-28 pt-7 md:pb-10">
      <header className="mb-5 flex items-center gap-3">
        <Link to="/" aria-label="Back to Home" className="btn btn-secondary h-9 min-h-0 w-9 shrink-0 p-0">
          <ArrowLeftIcon width={18} height={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[28px] leading-tight text-ink">Today's plan</h1>
          <p className="text-[13px] text-ink-soft-55">
            {plan
              ? `${tasks.length} tasks · ${plan.free_blocks.length} blocks of free time${doneCount ? ` · ${doneCount} done` : ""}`
              : "Built from your calendar, inbox and Canvas"}
          </p>
        </div>
      </header>

      <StatusBanners
        aiEnabled={aiEnabled && Boolean(settings.data)}
        loading={state.isPending}
        loadError={state.isError}
        generating={generate.isPending}
        generateError={generate.error}
        failure={failure}
        current={current}
        onRetry={() => generate.mutate()}
      />

      {plan && (
        <>
          {plan.note && (
            <p className="mb-6 rounded-card border border-card-border bg-card p-[18px] text-[14.5px] leading-relaxed text-ink">
              {plan.note}
            </p>
          )}

          <Timeline plan={plan} />

          {plan.unscheduled.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-1 text-[14px] font-medium text-ink">Not today</h2>
              <p className="mb-2.5 text-[13px] text-ink-soft-55">These didn't fit in today's free time.</p>
              <div className="overflow-hidden rounded-card border border-card-border bg-card">
                {plan.unscheduled.map((id, i) => (
                  <TaskRow key={id} task={plan.tasks[id]} first={i === 0} />
                ))}
              </div>
            </section>
          )}

          {current && (
            <p className="mt-6 text-center text-[12px] text-ink-soft-42">
              Generated {timeOf(current.generatedAt)}
              {plan.source.calls.length > 0 && ` · ${[...new Set(plan.source.calls.map((c) => c.provider))].join(", ")}`}
            </p>
          )}
        </>
      )}

      {aiEnabled && (
        <div className="fixed inset-x-0 bottom-(--bottom-nav-height) z-10 mx-auto max-w-[480px] border-t border-card-border bg-page/95 px-6 py-4 backdrop-blur md:static md:mt-6 md:max-w-none md:border-0 md:bg-transparent md:p-0">
          <PrimaryButton onClick={() => generate.mutate()} disabled={generate.isPending || state.isPending} className="md:w-auto">
            {generate.isPending ? "Planning…" : failure || generate.isError ? "Try again" : plan ? "Regenerate" : "Plan my day"}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

/**
 * What the page says about the plan's state. A failed generation is always shown, even when an
 * older plan is still on screen, so a stale plan is never presented as fresh.
 */
function StatusBanners({
  aiEnabled,
  loading,
  loadError,
  generating,
  generateError,
  failure,
  current,
  onRetry,
}: {
  aiEnabled: boolean;
  loading: boolean;
  loadError: boolean;
  generating: boolean;
  generateError: Error | null;
  failure: PlanFailure | null;
  current: DailyPlan | null;
  onRetry: () => void;
}) {
  const plan = current?.plan;
  const banners: React.ReactNode[] = [];

  if (!aiEnabled && !loading) {
    banners.push(<Notice key="off">{aiMessage(new ApiError(503, "ai_not_configured"))}</Notice>);
  }
  if (generating) {
    banners.push(
      <Notice key="gen" tone="info">
        Planning your day. This usually takes 10 to 30 seconds, and up to about a minute and a half on a busy day.
      </Notice>,
    );
  } else if (loading) {
    banners.push(
      <Notice key="load">Loading your plan. If it's your first visit today, it's being made now and can take up to a minute.</Notice>,
    );
  } else if (loadError) {
    banners.push(<Notice key="lerr" tone="danger">Couldn't load today's plan. Check your connection and reload.</Notice>);
  } else if (generateError || failure) {
    const detail = generateError ? aiMessage(generateError, "") : failure?.message;
    banners.push(
      <Notice key="fail" tone="danger" action={<button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">Try again</button>}>
        <strong className="font-medium">
          {plan ? "Couldn't make a new plan" : "Couldn't make today's plan"}
          {failure && !generateError ? ` at ${timeOf(failure.at)}` : ""}.
        </strong>{" "}
        {detail}
        {plan && current && ` You're seeing the earlier plan from ${timeOf(current.generatedAt)}.`}
      </Notice>,
    );
  } else if (!plan && aiEnabled) {
    banners.push(<Notice key="none">No plan yet today. One is made each morning, or you can make it now.</Notice>);
  }

  if (plan && !generating) {
    const fallbacks = plan.source.calls.filter((c) => c.fallback);
    if (fallbacks.length) {
      const steps = [...new Set(fallbacks.map((c) => stepLabels[c.task] ?? c.task))].join(", ");
      const used = [...new Set(fallbacks.map((c) => `${c.provider} · ${c.model}`))].join(", ");
      banners.push(
        <Notice key="fb" tone="info">
          <strong className="font-medium">Made with the backup AI</strong> for {steps}, because the main provider was busy or
          unavailable ({used}). The plan works the same way; quality may differ a little.
        </Notice>,
      );
    }
    for (const [i, w] of plan.warnings.entries()) banners.push(<Notice key={`w${i}`}>{w}</Notice>);
  }

  return banners.length ? <div className="mb-5 space-y-2.5">{banners}</div> : null;
}

function Notice({
  children,
  tone = "neutral",
  action,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info" | "danger";
  action?: React.ReactNode;
}) {
  const tones = {
    neutral: "border-card-border bg-card text-ink-soft-62",
    info: "border-card-border border-l-[3px] border-l-accent bg-card text-ink",
    danger: "border-danger/30 bg-danger/10 text-ink",
  };
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`flex items-start justify-between gap-3 rounded-card border p-4 text-[14px] leading-relaxed ${tones[tone]}`}
    >
      <p className="min-w-0 wrap-anywhere">{children}</p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Calendar events and free-time blocks in time order. Free blocks hold their task checklist. */
function Timeline({ plan }: { plan: DailyPlan["plan"] }) {
  const items = [
    ...plan.time_blocks.filter((b) => b.type !== "break").map((b) => ({ kind: "event" as const, start: b.start, block: b })),
    ...plan.free_blocks.map((b) => ({ kind: "free" as const, start: b.start, block: b })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  if (!items.length) {
    return <p className="text-[14px] text-ink-soft-62">Nothing on your calendar and no free time left today.</p>;
  }

  return (
    <ol className="space-y-2.5">
      {items.map((item) =>
        item.kind === "event" ? (
          <li key={`e-${item.start}-${item.block.label}`} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
            <p className="hidden pt-2.5 tabular text-[13px] text-ink-soft-55 sm:block">{formatClock(item.block.start)}</p>
            <div className={`min-w-0 rounded-button px-4 py-2.5 ${eventStyles[item.block.type]}`}>
              <p className="text-[14.5px] font-medium wrap-anywhere">{item.block.label}</p>
              <p className="tabular text-[12.5px] opacity-75">
                {formatClock(item.block.start)} – {formatClock(item.block.end)}
              </p>
            </div>
          </li>
        ) : (
          <li key={`f-${item.start}`} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
            <p className="hidden pt-3 tabular text-[13px] text-ink-soft-55 sm:block">{formatClock(item.block.start)}</p>
            <section className="min-w-0 overflow-hidden rounded-card border border-card-border bg-card" aria-label={`Free time from ${formatClock(item.block.start)}`}>
              <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-divider bg-accent-soft/50 px-4 py-2">
                <p className="whitespace-nowrap text-[13px] font-medium text-accent-hover">Free time</p>
                <p className="whitespace-nowrap tabular text-[12.5px] text-ink-soft-55">
                  {formatClock(item.block.start)} – {formatClock(item.block.end)} · {formatDuration(item.block.minutes)}
                </p>
              </header>
              {item.block.items.length ? (
                item.block.items.map((it, i) => (
                  <TaskRow
                    key={`${it.task_id}-${it.part}`}
                    task={plan.tasks[it.task_id]}
                    part={it.parts > 1 ? `Part ${it.part} of ${it.parts}` : null}
                    first={i === 0}
                  />
                ))
              ) : (
                <p className="px-4 py-3 text-[13.5px] text-ink-soft-55">Open time. Nothing scheduled here.</p>
              )}
            </section>
          </li>
        ),
      )}
    </ol>
  );
}

/** One checklist item: tick it off, see where it's from and when it's due, and correct its size. */
function TaskRow({ task, part = null, first }: { task: PlanTask; part?: string | null; first: boolean }) {
  const { data: user } = useCurrentUser();
  const setDone = useSetTaskDone();
  const setSize = useSetTaskSize();
  const style = sourceStyles[task.source];
  const due = task.due ? formatTaskDue(task.due) : null;
  const href =
    task.source === "canvas" ? task.url ?? null : task.source === "email" && task.source_id ? gmailUrl(task.source_id, user?.email) : null;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${first ? "" : "border-t border-divider"}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={Boolean(task.done)}
        aria-label={`${task.done ? "Uncheck" : "Check off"} ${task.title}`}
        disabled={setDone.isPending}
        onClick={() => setDone.mutate({ taskId: task.id, done: !task.done })}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors ${
          task.done ? `${style.check} text-cta-on-ink` : "border-ink/30 hover:border-ink/60"
        }`}
      >
        {task.done && (
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`text-[14.5px] wrap-anywhere ${task.done ? "text-ink-soft-42 line-through" : "text-ink"}`}>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {task.title}
              <ArrowUpRightIcon width={13} height={13} className="ml-1 inline-block align-[-1px] text-ink-soft-42" aria-hidden="true" />
            </a>
          ) : (
            task.title
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-soft-55">
          <span className={`min-w-0 rounded px-1.5 py-px font-medium wrap-anywhere ${style.chip}`}>
            {style.label}
            {task.course ? ` · ${task.course}` : ""}
          </span>
          {task.missing ? (
            <span className="font-medium text-danger">Missing</span>
          ) : due ? (
            <span className={due.overdue ? "font-medium text-danger" : due.urgent ? "font-medium text-accent-hover" : ""}>{due.label}</span>
          ) : null}
          {part && <span>{part}</span>}
        </div>
        {task.note && !task.done && <p className="mt-1 text-[13px] leading-snug text-ink-soft-55 wrap-anywhere">{task.note}</p>}
      </div>

      {task.minutes ? (
        <span className="shrink-0 pt-0.5 tabular text-[12.5px] text-ink-soft-55">{task.minutes} min</span>
      ) : (
        <label className="shrink-0">
          <span className="sr-only">Size of {task.title}</span>
          <select
            value={task.size}
            disabled={setSize.isPending}
            onChange={(e) => setSize.mutate({ taskId: task.id, size: e.target.value as TaskSize })}
            title={task.size_source === "you" ? "Your size (remembered for this task)" : "Change the size; it's remembered for this task"}
            className={`cursor-pointer rounded-button border bg-card py-1 pl-2 pr-1 text-[12.5px] font-medium ${
              task.size_source === "you" ? "border-accent/40 text-accent-hover" : "border-card-border text-ink-soft-62"
            }`}
          >
            {(Object.keys(sizeLabels) as TaskSize[]).map((s) => (
              <option key={s} value={s}>
                {sizeLabels[s]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
