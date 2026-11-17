import type { ComponentType, SVGProps } from "react";

/** Each area of the app keeps one colour, used for its icon here and its blocks on the Plan page. */
export type Tone = "accent" | "calendar" | "scripture" | "workout" | "coursework" | "neutral";

const toneClasses: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent",
  calendar: "bg-calendar-soft text-calendar",
  scripture: "bg-scripture-soft text-scripture",
  workout: "bg-workout-soft text-workout",
  coursework: "bg-coursework-soft text-coursework",
  neutral: "bg-ink/[0.06] text-ink-soft-62",
};

/** Heading above a card. Sentence case; an optional coloured icon on the left and action on the right. */
export function SectionLabel({
  children,
  action,
  Icon,
  tone = "neutral",
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: Tone;
}) {
  return (
    <div className="mb-2.5 flex min-h-8 items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[14px] font-medium text-ink">
        {Icon && (
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ${toneClasses[tone]}`}>
            <Icon width={14} height={14} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
        {children}
      </h2>
      {action && <div className="text-[13px] text-ink-soft-55">{action}</div>}
    </div>
  );
}
