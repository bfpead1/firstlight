// Generates and saves the daily plan. Used by POST /api/plan/generate, the first load of the
// day, and the morning job. Gathers the data; plan/pipeline.js does the work.
import { generateJson } from "../ai/llm.js";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { CanvasError, canvasConnection, fetchDescription, fetchMissing, fetchUpcoming } from "../lib/canvas.js";
import { clientForUser, connectionsFromScope } from "../lib/google.js";
import { fetchEmailBody, fetchEvents, fetchRecentEmails } from "../lib/googleData.js";
import { localDate, localDayRange, localTime, toMinutes } from "../lib/time.js";
import { getSettings } from "../routes/settings.js";
import { activePlan } from "../workout/activePlan.js";
import { workoutForDate } from "../workout/schedule.js";
import { buildDailyPlan } from "./pipeline.js";

const COURSEWORK_DAYS = 3;

/** Plans saved before the free-time pipeline have no version; they count as missing. */
export const PLAN_VERSION = 2;
export const isCurrentPlan = (brief) => brief?.version === PLAN_VERSION;

/**
 * Canvas work due soon plus missing work, with the connection for fetching descriptions.
 * null if Canvas isn't connected; "unavailable" if it errored, so an outage never blocks the plan.
 */
async function gatherCoursework(userId, dayStart) {
  let conn;
  try {
    conn = await canvasConnection(userId);
  } catch (err) {
    if (err instanceof CanvasError && err.code === "canvas_not_connected") return { conn: null, coursework: null };
    return { conn: null, coursework: "unavailable" };
  }
  try {
    const end = new Date(dayStart.getTime() + COURSEWORK_DAYS * 24 * 60 * 60 * 1000);
    const [upcoming, missing] = await Promise.all([fetchUpcoming(conn, { start: dayStart, end }), fetchMissing(conn)]);
    return { conn, coursework: { upcoming, missing } };
  } catch (err) {
    console.warn(`Canvas unavailable for daily plan: ${err.code ?? ""}`);
    return { conn: null, coursework: "unavailable" };
  }
}

export function todayInAppZone() {
  return localDate(new Date(), config.timeZone);
}

/** Timed events as local HH:MM, clipped to the day; all-day event titles separately. */
function localizeEvents(events, range, timeZone) {
  const timed = [];
  const allDay = [];
  for (const e of events) {
    if (e.allDay) {
      allDay.push(e.title);
      continue;
    }
    const start = new Date(e.start) <= range.start ? "00:00" : localTime(new Date(e.start), timeZone);
    const end = new Date(e.end) >= range.end ? "23:59" : localTime(new Date(e.end), timeZone);
    if (toMinutes(end) > toMinutes(start)) timed.push({ start, end, title: e.title });
  }
  return { timed, allDay };
}

/** Builds today's plan, saves it, and returns { date, plan, generatedAt }. Throws AiError or Google errors. */
export async function generateDailyPlan(user, date = todayInAppZone()) {
  const timeZone = config.timeZone;
  const range = localDayRange(date, timeZone);
  const connections = connectionsFromScope(user.tokens.scope);
  const google = clientForUser(user);

  const [rawEvents, rawEmails, settings, { plan: workoutPlan }, { conn, coursework }] = await Promise.all([
    connections.calendar ? fetchEvents(google, range) : null,
    connections.gmail ? fetchRecentEmails(google, { max: 15 }) : null,
    getSettings(user.id),
    activePlan(user.id),
    gatherCoursework(user.id, range.start),
  ]);

  const { timed, allDay } = rawEvents ? localizeEvents(rawEvents, range, timeZone) : { timed: [], allDay: [] };
  const { day } = workoutForDate(workoutPlan, settings, date);
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const isToday = date === todayInAppZone();

  const plan = await buildDailyPlan(
    {
      date,
      weekday,
      timeZone,
      now: isToday ? localTime(new Date(), timeZone) : null,
      events: timed,
      allDay,
      emails: rawEmails?.map(({ id, from, subject, snippet }) => ({ id, from, subject, snippet })) ?? null,
      coursework,
      workout: day && day.type !== "rest" ? { title: day.title, minutes: day.durationMinutes } : null,
      scripture: { minutes: settings.scripturePace.minutesPerSession },
      sizeMemory: settings.taskSizes ?? {},
    },
    {
      generateJson,
      fetchEmailBody: (id) => fetchEmailBody(google, id),
      fetchDescription: (item) => (conn ? fetchDescription(conn, item) : null),
      log: (message) => console.log(`[plan] ${message}`),
    },
  );

  const row = await db.briefs.save(user.id, date, plan);
  return { date, plan: row.brief, generatedAt: row.createdAt };
}
