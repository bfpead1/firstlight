import { Link } from "react-router-dom";
import { PrimaryButton } from "../components/PrimaryButton";
import { ArrowLeftIcon } from "../components/icons";
import { ApiError } from "../lib/api";
import { aiMessage, type BlockType, formatClock, useGeneratePlan, useTodayPlan } from "../lib/plan";
import { useSettings } from "../lib/settings";

const blockStyles: Record<BlockType, string> = {
  class: "bg-calendar-soft text-calendar",
  task: "bg-accent-soft text-accent-hover",
  workout: "bg-workout-soft text-workout",
  study: "bg-scripture-soft text-scripture",
  break: "bg-page border border-dashed border-card-border text-ink-soft-62",
};

const typeLabels: Record<BlockType, string> = {
  class: "Class",
  task: "Task",
  workout: "Workout",
  study: "Study",
  break: "Break",
};

export function Plan() {
  const settings = useSettings();
  const aiEnabled = settings.data?.features.ai ?? false;
  const today = useTodayPlan();
  const generate = useGeneratePlan();
  const data = today.data?.plan;

  return (
    <div className="px-6 pb-28 pt-7 md:pb-10">
      <header className="mb-5 flex items-center gap-3">
        <Link
          to="/"
          aria-label="Back to Home"
          className="btn btn-secondary h-9 min-h-0 w-9 shrink-0 p-0"
        >
          <ArrowLeftIcon width={18} height={18} />
        </Link>
        <div>
          <h1 className="font-display text-[28px] leading-tight text-ink">Today's plan</h1>
          <p className="text-[13px] text-ink-soft-55">
            {data
              ? `${data.order.length} tasks · ${data.free_blocks.length} blocks of free time`
              : "Built from your calendar and inbox"}
          </p>
        </div>
      </header>

      {generate.isError && (
        <Notice>
          {aiMessage(generate.error)}
          {data && " Showing the plan you already had."}
        </Notice>
      )}

      {settings.data && !aiEnabled ? (
        <Notice>{aiMessage(new ApiError(503, "ai_not_configured"))}</Notice>
      ) : generate.isPending ? (
        <Notice>Planning your day… this usually takes 5–30 seconds.</Notice>
      ) : today.isPending ? (
        <Notice>Loading…</Notice>
      ) : today.isError ? (
        <Notice>Couldn't load today's plan.</Notice>
      ) : !data ? (
        !generate.isError && (
          <Notice>No plan yet today. It's made automatically each morning, or tap the button below.</Notice>
        )
      ) : (
        <>
          {data.note && (
            <section className="mb-6 rounded-card border border-card-border bg-card p-[18px]">
              <p className="text-[14.5px] leading-relaxed text-ink">{data.note}</p>
            </section>
          )}

          <section className="mb-4">
            <ol className="space-y-2">
              {data.time_blocks.map((block) => (
                <li key={`${block.start}-${block.label}`} className="grid grid-cols-[72px_1fr] items-start gap-3">
                  <p className="pt-3 tabular text-[13px] text-ink-soft-55">{formatClock(block.start)}</p>
                  <div className={`rounded-button px-4 py-3 ${blockStyles[block.type]}`}>
                    <p className="text-[15px] font-medium">{block.label}</p>
                    <p className="mt-0.5 text-[12.5px] opacity-70">
                      {typeLabels[block.type]} · until {formatClock(block.end)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {today.data && (
            <p className="text-center text-[12px] text-ink-soft-42">
              Generated {new Date(today.data.generatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </p>
          )}
        </>
      )}

      {aiEnabled && (
        <div className="fixed inset-x-0 bottom-16 z-10 mx-auto max-w-[480px] border-t border-card-border bg-page/95 px-6 py-4 backdrop-blur md:static md:mt-6 md:max-w-none md:border-0 md:bg-transparent md:p-0">
          <PrimaryButton onClick={() => generate.mutate()} disabled={generate.isPending} className="md:w-auto">
            {generate.isPending
              ? "Planning…"
              : generate.isError
                ? "Retry"
                : data
                  ? "Regenerate"
                  : "Plan my day"}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 rounded-card border border-card-border bg-card p-[18px] text-[14px] leading-relaxed text-ink-soft-62">
      {children}
    </p>
  );
}
