import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, ListRow } from "../components/Card";
import { EventEditor } from "../components/EventEditor";
import { GoogleDataState } from "../components/GoogleDataState";
import { PrimaryButton } from "../components/PrimaryButton";
import { SectionLabel } from "../components/SectionLabel";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CheckListIcon,
  ChevronRightIcon,
  DumbbellIcon,
  MailIcon,
  PlanIcon,
  PlusIcon,
  StudyIcon,
  SunCloudIcon,
} from "../components/icons";
import { thoughtForDate } from "../data/thoughts";
import { ApiError, localDateString } from "../lib/api";
import { GOOGLE_RECONNECT_URL, useCurrentUser } from "../lib/auth";
import { canvasMessage, formatDue, useCanvasStatus, useCanvasUpcoming } from "../lib/canvas";
import {
  aiMessage,
  type DailyPlan,
  formatTaskDue,
  openPriorities,
  type PlanTask,
  sizeLabels,
  useGeneratePlan,
  useSetTaskDone,
  useTodayPlan,
} from "../lib/plan";
import {
  type CalendarEvent,
  formatEventTime,
  gmailUrl,
  senderName,
  useRecentEmails,
  useTodayEvents,
} from "../lib/google";
import { nextSession, sessionLabel, useScriptureProgress } from "../lib/scripture";
import { useSettings, useUpdateSettings } from "../lib/settings";
import { currentPosition, describeWeather, useWeather } from "../lib/weather";
import { itemCount, todaysWorkout, useWorkoutLogs, useWorkoutPlan } from "../lib/workout";

const today = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function Home() {
  const { data: user } = useCurrentUser();
  const firstName = user?.name.split(" ")[0] ?? "";
  const events = useTodayEvents();
  const emails = useRecentEmails();
  const settings = useSettings();
  const plan = useWorkoutPlan();
  const workoutLogs = useWorkoutLogs();
  const progress = useScriptureProgress();
  const todayPlan = useTodayPlan();
  const generate = useGeneratePlan();
  const aiEnabled = settings.data?.features.ai ?? false;

  // Next timed event that hasn't finished yet; all-day events aren't "up" at a time.
  const [now] = useState(Date.now);
  const firstUp = events.data?.find(
    (e) => !e.allDay && new Date(e.end).getTime() > now,
  );

  const workout =
    plan.data && settings.data
      ? todaysWorkout(plan.data.plan, settings.data.workoutCycleStart, settings.data.workoutOverride)
      : null;
  const session =
    progress.data && settings.data
      ? nextSession(progress.data, settings.data.scripturePace)
      : undefined;
  const thought = thoughtForDate();
  const doneToday =
    workoutLogs.data?.find((l) => l.date === localDateString() && l.dayTitle === workout?.day?.title)
      ?.completed.length ?? 0;
  const importantEmails = todayPlan.data?.plan.email_actions;
  const canEditCalendar = user?.connections.calendarEdit ?? false;
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);

  return (
    <div className="px-6 pb-10 pt-7 md:pt-9">
      <header className="sunrise mb-8 rounded-[16px] border border-sunrise-border p-5 md:p-7">
        <p className="text-[13px] font-medium text-accent-hover">{today}</p>
        <h1 className="mt-1 font-display text-[30px] leading-[1.1] text-ink md:text-[36px]">
          Good morning, {firstName}
        </h1>
        <figure className="mt-3 max-w-[640px]">
          <blockquote className="text-[15.5px] leading-relaxed text-ink/85">“{thought.text}”</blockquote>
          <figcaption className="mt-1 text-[13px] text-ink-soft-55">{thought.source}</figcaption>
        </figure>

        <div className="mt-5 grid overflow-hidden rounded-card border border-card-border bg-card sm:grid-cols-2">
          <div className="min-w-0 px-[18px] py-3.5">
            <p className="flex items-center gap-1.5 text-[12.5px] text-ink-soft-55">
              <span className="h-1.5 w-1.5 rounded-full bg-calendar" aria-hidden="true" />
              Next up
            </p>
            {firstUp ? (
              <p className="mt-0.5 truncate text-[15px] font-medium text-ink">
                {firstUp.title}
                <span className="ml-2 tabular text-[13px] font-normal text-ink-soft-55">
                  {formatEventTime(firstUp)}
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-[15px] text-ink-soft-62">
                {events.isPending
                  ? "Loading…"
                  : events.isError
                    ? "Couldn't load your calendar."
                    : "Nothing else on your calendar today."}
              </p>
            )}
          </div>
          <WeatherSummary />
        </div>
      </header>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-7">
          <section>
            <SectionLabel
              Icon={CheckListIcon}
              tone="accent"
              action={
                aiEnabled &&
                todayPlan.data && (
                  <button
                    type="button"
                    onClick={() => generate.mutate()}
                    disabled={generate.isPending}
                    className="btn btn-quiet btn-sm"
                  >
                    {generate.isPending ? "Regenerating…" : "Regenerate"}
                  </button>
                )
              }
            >
              Today's priorities
            </SectionLabel>
            <Card padded={false}>
              {generate.isError && (
                <div className="flex items-center justify-between gap-3 border-b border-divider px-[18px] py-3">
                  <p className="text-[13.5px] text-ink">{aiMessage(generate.error)}</p>
                  <button type="button" onClick={() => generate.mutate()} className="btn btn-secondary btn-sm">
                    Retry
                  </button>
                </div>
              )}
              {settings.data && !aiEnabled ? (
                <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">
                  {aiMessage(new ApiError(503, "ai_not_configured"))}
                </p>
              ) : generate.isPending ? (
                <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">
                  Planning your day. This usually takes 5 to 30 seconds.
                </p>
              ) : todayPlan.data ? (
                <PriorityList plan={todayPlan.data.plan} />
              ) : todayPlan.isPending ? (
                <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">Loading…</p>
              ) : todayPlan.isError ? (
                <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">Couldn't load today's plan.</p>
              ) : (
                !generate.isError && (
                  <div className="px-[18px] py-4">
                    <p className="mb-3 text-[14px] text-ink-soft-62">
                      No plan yet today. One is made each morning, or you can make it now.
                    </p>
                    <PrimaryButton onClick={() => generate.mutate()} className="sm:w-auto">
                      Plan my day
                    </PrimaryButton>
                  </div>
                )
              )}
              <Link
                to="/plan"
                className="row-link flex items-center justify-between border-t border-divider px-[18px] py-3 text-[14px] font-medium text-ink"
              >
                See the full schedule
                <ChevronRightIcon width={16} height={16} className="text-ink-soft-42" />
              </Link>
            </Card>
          </section>

          <section>
            <SectionLabel
              Icon={PlanIcon}
              tone="calendar"
              action={
                canEditCalendar ? (
                  <button type="button" onClick={() => setEditing("new")} className="btn btn-quiet btn-sm">
                    <PlusIcon width={15} height={15} />
                    Add event
                  </button>
                ) : (
                  user?.connections.calendar && (
                    <a href={GOOGLE_RECONNECT_URL} className="btn btn-quiet btn-sm">
                      Allow editing
                    </a>
                  )
                )
              }
            >
              Calendar
            </SectionLabel>
            <Card padded={false}>
              {!events.data ? (
                <GoogleDataState isPending={events.isPending} error={events.error} />
              ) : events.data.length === 0 ? (
                <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">No events on your calendar today.</p>
              ) : (
                events.data.map((e, i) => {
                  const row = (
                    <>
                      <span className="w-[68px] shrink-0 border-l-2 border-calendar pl-2.5 tabular text-[12.5px] text-ink-soft-55">
                        {formatEventTime(e)}
                      </span>
                      <span className="min-w-0 truncate text-[15px] text-ink">{e.title}</span>
                    </>
                  );
                  return canEditCalendar && e.editable ? (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEditing(e)}
                      aria-label={`Edit ${e.title}`}
                      className={`row-link flex w-full items-center gap-3 px-[18px] py-3 text-left ${i === 0 ? "" : "border-t border-divider"}`}
                    >
                      {row}
                      <ChevronRightIcon width={16} height={16} className="ml-auto shrink-0 text-ink-soft-42" />
                    </button>
                  ) : (
                    <ListRow key={e.id} first={i === 0}>
                      {row}
                    </ListRow>
                  );
                })
              )}
            </Card>
          </section>

          {editing && (
            <EventEditor event={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
          )}

          <section>
            <SectionLabel Icon={MailIcon}>{importantEmails ? "Emails to act on" : "Inbox"}</SectionLabel>
            <Card padded={false}>
              {importantEmails ? (
                importantEmails.length === 0 ? (
                  <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">
                    Nothing in your inbox needs attention.
                  </p>
                ) : (
                  importantEmails.map((e, i) => (
                    <EmailLink key={e.email_id} id={e.email_id} account={user?.email} first={i === 0}>
                      <div className="min-w-0">
                        <p className="text-[14.5px] text-ink">{e.suggestion}</p>
                        <p className="mt-0.5 truncate text-[13px] text-ink-soft-55">
                          {senderName(e.from)} · {e.subject}
                        </p>
                      </div>
                    </EmailLink>
                  ))
                )
              ) : !emails.data ? (
                <GoogleDataState isPending={emails.isPending} error={emails.error} />
              ) : emails.data.length === 0 ? (
                <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">
                  No new emails in your primary inbox.
                </p>
              ) : (
                emails.data.slice(0, 5).map((e, i) => (
                  <EmailLink key={e.id} id={e.id} account={user?.email} first={i === 0}>
                    <div className="min-w-0">
                      <p className={`truncate text-[14.5px] text-ink ${e.unread ? "font-medium" : ""}`}>
                        {e.unread && (
                          <span
                            className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
                            aria-label="Unread"
                          />
                        )}
                        {e.subject}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-ink-soft-55">{senderName(e.from)}</p>
                    </div>
                  </EmailLink>
                ))
              )}
            </Card>
          </section>
        </div>

        <div className="space-y-7">
          <CourseworkSection />

          <section>
            <SectionLabel Icon={BookOpenIcon} tone="scripture">
              Scripture study
            </SectionLabel>
            <Card>
              {session === undefined ? (
                <p className="text-[14px] text-ink-soft-62">Loading…</p>
              ) : session === null ? (
                <p className="font-display text-[19px] text-ink">You've finished the Book of Mormon.</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-display text-[20px] text-ink">{sessionLabel(session.chapters)}</p>
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-ink-soft-55">
                    Day {session.number} · about {session.minutes} min
                  </p>
                </>
              )}
              <Link to="/study" className="btn btn-secondary mt-4 w-full">
                Open today's reading
              </Link>
            </Card>
          </section>

          <section>
            <SectionLabel Icon={DumbbellIcon} tone="workout">
              Workout
            </SectionLabel>
            <Card>
              {!workout?.day ? (
                <p className="text-[14px] text-ink-soft-62">Loading…</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-display text-[20px] text-ink">{workout.day.title}</p>
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-ink-soft-55">
                    {workout.week.label}
                    {workout.day.type !== "rest" &&
                      (doneToday
                        ? ` · ${doneToday} of ${itemCount(workout.day)} done`
                        : ` · about ${workout.day.durationMinutes} min · ${itemCount(workout.day)} exercises`)}
                  </p>
                  {workout.day.type === "rest" ? (
                    <p className="mt-3 text-[14px] text-ink-soft-62">{workout.day.note}</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-divider border-y border-divider">
                      {workout.day.sections[0].items.slice(0, 4).map((item) => (
                        <li
                          key={item.name}
                          className="flex items-center justify-between gap-3 py-2 text-[14px] text-ink"
                        >
                          <span className="min-w-0 truncate">{item.name}</span>
                          {item.amount && (
                            <span className="shrink-0 tabular text-[12.5px] text-ink-soft-55">{item.amount}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link to="/workout" className="btn btn-secondary mt-4 w-full">
                    {workout.day.type === "rest"
                      ? "See the workout plan"
                      : doneToday
                        ? "Continue the workout"
                        : "Start the workout"}
                  </Link>
                </>
              )}
            </Card>
          </section>

        </div>
      </div>
    </div>
  );
}

/** A row in the email list that opens the message in Gmail. */
function EmailLink({
  id,
  account,
  first,
  children,
}: {
  id: string;
  account: string | undefined;
  first: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={gmailUrl(id, account)}
      target="_blank"
      rel="noopener noreferrer"
      className={`row-link flex items-start gap-3 px-[18px] py-3 ${first ? "" : "border-t border-divider"}`}
    >
      {children}
      <ArrowUpRightIcon width={15} height={15} className="ml-auto mt-1 shrink-0 text-ink-soft-42" aria-hidden="true" />
    </a>
  );
}

/** Weather cell in the header strip, with location setup when none is saved. */
function WeatherSummary() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const location = settings.data?.location;
  const weather = useWeather(location);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  async function useMyLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      updateSettings.mutate({ location: await currentPosition() });
    } catch (err) {
      setLocationError((err as Error).message);
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-divider px-[18px] py-3.5 sm:border-l sm:border-t-0">
      {settings.data && !location ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
          <p className="text-[13.5px] text-ink-soft-62">
            {locationError ? `${locationError}.` : "Add your location for the weather."}
          </p>
          <div className="flex gap-1">
            <button type="button" onClick={useMyLocation} disabled={locating} className="btn btn-secondary btn-sm">
              {locating ? "Locating…" : "Use my location"}
            </button>
            <Link to="/settings" className="btn btn-quiet btn-sm">
              Search
            </Link>
          </div>
        </div>
      ) : weather.data ? (
        <>
          <SunCloudIcon width={26} height={26} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">
              <span className="tabular">{weather.data.tempNow}°</span>
              <span className="ml-2 text-[13.5px] font-normal text-ink-soft-55">
                high <span className="tabular">{weather.data.tempHigh}°</span>
              </span>
            </p>
            <p className="truncate text-[13px] text-ink-soft-55">
              {describeWeather(weather.data)}
              {location && ` · ${location.label}`}
            </p>
          </div>
        </>
      ) : (
        <p className="text-[14px] text-ink-soft-62">
          {weather.isError ? "Couldn't load the weather." : "Loading weather…"}
        </p>
      )}
    </div>
  );
}

/** Canvas work due in the next 7 days, plus anything missing. Hidden until Canvas is connected. */
function CourseworkSection() {
  const status = useCanvasStatus();
  const connected = status.data?.connected ?? false;
  const coursework = useCanvasUpcoming(connected);
  if (!connected) return null;

  const missing = coursework.data?.missing ?? [];
  const upcoming = (coursework.data?.upcoming ?? []).filter((i) => !i.done);
  const doneCount = (coursework.data?.upcoming ?? []).filter((i) => i.done).length;

  return (
    <section>
      <SectionLabel Icon={StudyIcon} tone="coursework">
        Due this week
      </SectionLabel>
      <Card padded={false}>
        {coursework.isPending ? (
          <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">Loading…</p>
        ) : coursework.isError ? (
          <div className="flex items-center justify-between gap-3 px-[18px] py-3">
            <p className="text-[14px] text-ink-soft-62">{canvasMessage(coursework.error)}</p>
            {coursework.error instanceof ApiError && coursework.error.code === "canvas_auth_failed" ? (
              <Link to="/settings" className="btn btn-secondary btn-sm">
                Settings
              </Link>
            ) : (
              <button type="button" onClick={() => coursework.refetch()} className="btn btn-secondary btn-sm">
                Retry
              </button>
            )}
          </div>
        ) : missing.length === 0 && upcoming.length === 0 ? (
          <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">
            Nothing due in the next 7 days{doneCount ? `, and ${doneCount} already done` : ""}.
          </p>
        ) : (
          <>
            {[
              ...missing.map((item) => ({ item, missing: true })),
              ...upcoming.map((item) => ({ item, missing: false })),
            ].map(({ item, missing: isMissing }, i) => (
              <a
                key={item.id}
                href={item.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`row-link flex items-start gap-3 px-[18px] py-3 ${i === 0 ? "" : "border-t border-divider"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] text-ink">{item.title}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-soft-55">
                    {isMissing ? <strong className="font-medium text-danger">Missing · </strong> : null}
                    {item.course ? `${item.course} · ` : ""}
                    {formatDue(item.dueAt)}
                    {item.points ? ` · ${item.points} pts` : ""}
                  </p>
                </div>
                <ArrowUpRightIcon width={15} height={15} className="mt-1 shrink-0 text-ink-soft-42" aria-hidden="true" />
              </a>
            ))}
            {doneCount > 0 && (
              <p className="border-t border-divider px-[18px] py-2.5 text-[13px] text-ink-soft-55">
                {doneCount} more due this week already submitted
              </p>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

const sourceLabels: Record<PlanTask["source"], string> = {
  canvas: "Canvas",
  email: "Email",
  workout: "Workout",
  scripture: "Scripture",
};

/**
 * Today's open priorities. Hovering (or focusing) a number turns it into a checkbox; checking
 * it off marks the task done everywhere and drops it from this list, and the next tasks in
 * the plan move up. The last one checked can be undone for a few seconds.
 */
function PriorityList({ plan }: { plan: DailyPlan["plan"] }) {
  const setDone = useSetTaskDone();
  const [lastChecked, setLastChecked] = useState<PlanTask | null>(null);
  const items = openPriorities(plan);

  useEffect(() => {
    if (!lastChecked) return;
    const timer = setTimeout(() => setLastChecked(null), 8000);
    return () => clearTimeout(timer);
  }, [lastChecked]);

  function check(task: PlanTask) {
    setDone.mutate({ taskId: task.id, done: true });
    setLastChecked(task);
  }

  function undo() {
    if (!lastChecked) return;
    setDone.mutate({ taskId: lastChecked.id, done: false });
    setLastChecked(null);
  }

  return (
    <>
      {items.length === 0 ? (
        <p className="px-[18px] py-3.5 text-[14px] text-ink-soft-62">Everything on today's list is done.</p>
      ) : (
        items.map(({ task, reason }, i) => {
          const due = task.due ? formatTaskDue(task.due) : null;
          return (
            <ListRow key={task.id} first={i === 0} className="group items-start py-3.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={false}
                aria-label={`Check off ${task.title}`}
                onClick={() => check(task)}
                className="relative -my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[13px] font-medium text-accent transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute inset-[5px] rounded-[5px] border-[1.5px] border-accent opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent-soft [@media(hover:none)]:opacity-100"
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-ink">{task.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-ink-soft-55">
                  {reason ??
                    [
                      "Up next",
                      sourceLabels[task.source] + (task.course ? ` · ${task.course}` : ""),
                      task.missing ? "Missing" : due?.label,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                </p>
              </div>
              <span className="shrink-0 pt-px text-[12.5px] text-ink-soft-55">
                {task.minutes ? `${task.minutes} min` : sizeLabels[task.size]}
              </span>
            </ListRow>
          );
        })
      )}
      {lastChecked && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-t border-divider bg-accent-soft/40 px-[18px] py-2"
        >
          <p className="min-w-0 truncate text-[13.5px] text-ink-soft-62">
            Checked off <span className="text-ink">{lastChecked.title}</span>
          </p>
          <button type="button" onClick={undo} className="btn btn-quiet btn-sm shrink-0">
            Undo
          </button>
        </div>
      )}
    </>
  );
}
