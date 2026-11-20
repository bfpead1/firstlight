// Sample data for guest mode. Everything is made up and dated relative to today, so the
// pages always look like a normal morning.
import { ALL_CHAPTERS } from "../../data/bookOfMormon";
import { localDateString } from "../api";
import type { CurrentUser } from "../auth";
import type { CanvasStatus, CourseworkItem, MissingItem } from "../canvas";
import type { CalendarEvent, EmailSummary } from "../google";
import type { TaskSize } from "../plan";
import type { ScriptureProgress } from "../scripture";
import type { Settings } from "../settings";
import type {
  BodyMetric,
  PlanItem,
  PlanSection,
  WorkoutLog,
  WorkoutPlan,
} from "../workout";

export const GUEST_USER: CurrentUser = {
  id: "guest",
  email: "guest@example.com",
  name: "Guest",
  picture: null,
  connections: { gmail: true, calendar: true, calendarEdit: true },
};

// ─── Dates ─────────────────────────────────────────────────────────────────

export function daysFromToday(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/** ISO timestamp for HH:MM local time, `days` from today. */
export function at(hhmm: string, days = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = daysFromToday(days);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function mondayOfThisWeek() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDateString(d);
}

// ─── Workout plan ──────────────────────────────────────────────────────────

const ex = (
  name: string,
  detail: string | null,
  amount: string | null,
  swap = false,
): PlanItem => ({ name, detail, amount, swap });
const act = (name: string, detail: string): PlanItem => ({
  name,
  detail,
  amount: null,
  swap: false,
});
const section = (
  title: string,
  kind: PlanSection["kind"],
  items: PlanItem[],
): PlanSection => ({ title, kind, items });

const CORE = section("Core Circuit: 3 Rounds, 40s on / 20s off", "hiit", [
  ex("Plank Hold", null, "40 sec"),
  ex("Dead Bug", null, "40 sec"),
  ex("Russian Twists", null, "40 sec"),
  ex("Leg Raises", null, "40 sec"),
]);

const WEEK_1: WorkoutPlan["weeks"][number] = {
  label: "Week 1",
  banner: null,
  days: [
    {
      weekday: "mon",
      title: "Upper Body Push & Pull",
      type: "push",
      durationMinutes: 50,
      sections: [
        section("Push", "exercises", [
          ex("Dumbbell Bench Press", "Chest, main lift", "4 × 8–10"),
          ex("Overhead Press", "Shoulders", "3 × 10"),
          ex("Tricep Rope Pushdown", "Triceps", "3 × 12", true),
        ]),
        section("Pull", "exercises", [
          ex("Lat Pulldown", "Wide grip", "3 × 10–12"),
          ex("Seated Cable Row", "Mid back", "3 × 10–12", true),
          ex("Hammer Curls", "Biceps", "3 × 12"),
        ]),
      ],
      note: "Control the lowering on every rep.",
    },
    {
      weekday: "tue",
      title: "Legs + Core",
      type: "legs",
      durationMinutes: 55,
      sections: [
        section("Legs", "exercises", [
          ex("Goblet Squat", "Quads and glutes", "4 × 10"),
          ex("Romanian Deadlift", "Hamstrings", "3 × 10"),
          ex("Walking Lunges", "Single leg", "3 × 10 each"),
          ex("Calf Raises", null, "3 × 15"),
        ]),
        CORE,
      ],
      note: "Legs first while you're fresh.",
    },
    {
      weekday: "wed",
      title: "Easy Run",
      type: "hike",
      durationMinutes: 35,
      sections: [
        section("Run", "activities", [
          act("Warm-up walk, 5 min", "Loosen up before you pick up the pace."),
          act(
            "Easy run, 25 min",
            "Conversational pace. You should be able to talk.",
          ),
          act(
            "Cool-down walk and stretch, 5 min",
            "Calves, hamstrings and hips.",
          ),
        ]),
      ],
      note: "Keep it easy. This day builds your aerobic base.",
    },
    {
      weekday: "thu",
      title: "Full Body Strength",
      type: "strength",
      durationMinutes: 50,
      sections: [
        section("Strength", "exercises", [
          ex("Trap Bar Deadlift", "Main lift", "4 × 6"),
          ex("Incline Dumbbell Press", "Upper chest", "3 × 10"),
          ex("Single-Arm Dumbbell Row", null, "3 × 10 each"),
          ex("Split Squat", null, "3 × 8 each", true),
        ]),
      ],
      note: null,
    },
    {
      weekday: "fri",
      title: "Intervals + Core",
      type: "legs",
      durationMinutes: 40,
      sections: [
        section("Intervals", "activities", [
          act("Warm-up, 8 min", "Easy jog or bike."),
          act(
            "6 × 1 min hard / 1 min easy",
            "Hard means about 8 out of 10 effort.",
          ),
          act("Cool-down, 5 min", "Easy pace until your breathing settles."),
        ]),
        CORE,
      ],
      note: null,
    },
    {
      weekday: "sat",
      title: "Hike or Long Walk",
      type: "hike",
      durationMinutes: 90,
      sections: [
        section("Outdoors", "activities", [
          act("Trail hike, 3–5 miles", "Pick a route with some climbing."),
          act("Hydrate", "Bring at least a liter of water."),
        ]),
      ],
      note: "Active recovery. Enjoy being outside.",
    },
    {
      weekday: "sun",
      title: "Rest",
      type: "rest",
      durationMinutes: 0,
      sections: [],
      note: "Full rest day. Recover.",
    },
  ],
};

/** Two weeks, matching the app's default rotation; Week 2 repeats Week 1 with heavier sets. */
export const SAMPLE_WORKOUT_PLAN: WorkoutPlan = {
  name: "Sample 2-Week Plan",
  weeks: [
    WEEK_1,
    {
      ...WEEK_1,
      label: "Week 2",
      banner: "Heavier week: add a little weight to the main lifts.",
      days: WEEK_1.days.map((d) => ({ ...d })),
    },
  ],
};

// ─── Settings ──────────────────────────────────────────────────────────────

export function sampleSettings(): Omit<Settings, "features"> {
  return {
    workoutCycleStart: mondayOfThisWeek(),
    scripturePace: { daysPerWeek: 7, minutesPerSession: 15 },
    scriptureLearningMode: false,
    workoutOverride: null,
    workoutProfile: {
      goals: "Get stronger and improve cardio",
      equipment: "Dumbbells, barbell, cable machines, running trails",
      daysPerWeek: 6,
    },
    location: {
      latitude: 40.76,
      longitude: -111.89,
      label: "Salt Lake City, UT, US",
    },
  };
}

// ─── Calendar & Gmail ──────────────────────────────────────────────────────

const event = (
  id: string,
  title: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  title,
  start: at(start),
  end: at(end),
  allDay: false,
  location: null,
  description: null,
  htmlLink: null,
  editable: true,
  recurring: false,
  ...extra,
});

export function sampleEvents(): CalendarEvent[] {
  return [
    {
      ...event("ev-allday", "Sam's birthday", "00:00", "00:00"),
      start: localDateString(),
      end: localDateString(daysFromToday(1)),
      allDay: true,
    },
    event("ev-stat", "STAT 121 Lecture", "09:00", "09:50", {
      location: "Room 1170",
      recurring: true,
    }),
    event("ev-lab", "Biology Lab", "11:00", "12:15", {
      location: "Science Building",
      recurring: true,
    }),
    event("ev-lunch", "Lunch with Jordan", "12:30", "13:15", {
      location: "Campus café",
    }),
    event("ev-advisor", "Advisor meeting", "15:00", "15:30", {
      description: "Talk through next semester's classes.",
      editable: false,
    }),
    event("ev-shift", "Work shift", "17:30", "20:00"),
  ];
}

export const SAMPLE_EMAILS: EmailSummary[] = [
  {
    id: "demo-email-1",
    subject: "Can you send your part of the group slides?",
    from: "Maya Chen <maya@example.com>",
    date: at("07:12"),
    snippet:
      "Hey! We're putting the deck together tonight. Could you send your three slides by 6?",
    unread: true,
  },
  {
    id: "demo-email-2",
    subject: "Interview confirmation: Thursday at 2 PM",
    from: "Hiring Team <careers@example.com>",
    date: at("06:40"),
    snippet:
      "Thanks for confirming. Please reply with your availability for a short follow-up call.",
    unread: true,
  },
  {
    id: "demo-email-3",
    subject: "Your order has shipped",
    from: "Store <orders@example.com>",
    date: at("21:05", -1),
    snippet: "Good news! Your order is on its way and should arrive Friday.",
    unread: false,
  },
  {
    id: "demo-email-4",
    subject: "Club meeting moved to Wednesday",
    from: "Outdoors Club <club@example.com>",
    date: at("18:30", -1),
    snippet:
      "Heads up: this week's meeting is Wednesday at 7 PM in the usual room.",
    unread: false,
  },
  {
    id: "demo-email-5",
    subject: "Weekly digest",
    from: "Newsletter <news@example.com>",
    date: at("15:00", -1),
    snippet: "This week's top stories, picked for you.",
    unread: false,
  },
];

// ─── Canvas ────────────────────────────────────────────────────────────────

export const SAMPLE_CANVAS_STATUS: CanvasStatus = {
  connected: true,
  baseUrl: "https://canvas.example.edu",
  accountName: "Guest Student",
};

const coursework = (
  id: string,
  title: string,
  course: string,
  dueAt: string,
  points: number,
  extra: Partial<CourseworkItem> = {},
): CourseworkItem => ({
  id,
  title,
  course,
  type: "assignment",
  dueAt,
  points,
  url: null,
  submitted: false,
  graded: false,
  late: false,
  missing: false,
  done: false,
  ...extra,
});

export function sampleCoursework(): {
  upcoming: CourseworkItem[];
  missing: MissingItem[];
} {
  return {
    upcoming: [
      coursework("cw-1", "Problem Set 6", "STAT 121", at("23:59"), 20),
      coursework(
        "cw-2",
        "Lab Report: Enzyme Activity",
        "BIO 100",
        at("23:59", 1),
        50,
      ),
      coursework("cw-3", "Reading Quiz 8", "HIST 201", at("10:00", 2), 10, {
        type: "quiz",
      }),
      coursework("cw-4", "Discussion Post", "HIST 201", at("12:00", -1), 5, {
        submitted: true,
        done: true,
      }),
    ],
    missing: [
      {
        id: "cw-5",
        title: "Reflection Essay",
        course: "WRTG 150",
        dueAt: at("23:59", -2),
        points: 25,
        url: null,
      },
    ],
  };
}

// ─── Plan tasks ────────────────────────────────────────────────────────────

/** Tasks the "AI" would pull out of the inbox and Canvas, in priority order. */
export const SAMPLE_TASKS: {
  key: string;
  title: string;
  source: "email" | "canvas";
  source_id: string;
  due: string | null;
  size: TaskSize;
  note: string;
  missing?: boolean;
  course?: string;
  reason?: string;
}[] = [
  {
    key: "canvas:cw-1",
    title: "Problem Set 6",
    source: "canvas",
    source_id: "cw-1",
    due: `${localDateString()}T23:59`,
    size: "medium",
    course: "STAT 121",
    note: "Eight problems on confidence intervals.",
    reason: "Due tonight, and it's worth 20 points.",
  },
  {
    key: "email:demo-email-1",
    title: "Send your group slides to Maya",
    source: "email",
    source_id: "demo-email-1",
    due: `${localDateString()}T18:00`,
    size: "medium",
    note: "Maya needs your three slides by 6 PM.",
    reason: "Your group is waiting on it before 6 PM.",
  },
  {
    key: "canvas:cw-5",
    title: "Reflection Essay",
    source: "canvas",
    source_id: "cw-5",
    due: localDateString(daysFromToday(-2)),
    size: "long",
    missing: true,
    course: "WRTG 150",
    note: "Two days late. Check whether late work is still accepted.",
    reason: "It's missing; turning it in now saves partial credit.",
  },
  {
    key: "email:demo-email-2",
    title: "Reply with your availability for the follow-up call",
    source: "email",
    source_id: "demo-email-2",
    due: null,
    size: "quick",
    note: "",
  },
  {
    key: "canvas:cw-2",
    title: "Lab Report: Enzyme Activity",
    source: "canvas",
    source_id: "cw-2",
    due: `${localDateString(daysFromToday(1))}T23:59`,
    size: "long",
    course: "BIO 100",
    note: "Needs the graphs from Tuesday's lab.",
  },
];

export const SAMPLE_EMAIL_ACTIONS = [
  {
    email_id: "demo-email-1",
    suggestion: "Send Maya your three slides before 6 PM.",
  },
  {
    email_id: "demo-email-2",
    suggestion: "Reply with two or three times that work for a short call.",
  },
];

// ─── Workout history & body metrics ────────────────────────────────────────

export function sampleMetrics(): BodyMetric[] {
  return [0, 7, 14, 21, 28].map((daysAgo, i) => ({
    id: `metric-${i}`,
    measuredOn: localDateString(daysFromToday(-daysAgo)),
    weightLbs: 172 + i * 0.8,
    muscleMassLbs: 78 - i * 0.3,
    bodyFatPct: 18.2 + i * 0.3,
    note: i === 0 ? "Morning, before breakfast" : null,
    createdAt: at("07:00", -daysAgo),
  }));
}

const JS_DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Check-offs for most of the past two weeks, with a couple of skipped days. */
export function sampleLogs(plan: WorkoutPlan): WorkoutLog[] {
  const logs: WorkoutLog[] = [];
  for (let daysAgo = 1; daysAgo <= 14; daysAgo++) {
    if (daysAgo === 4 || daysAgo === 10) continue;
    const date = daysFromToday(-daysAgo);
    const week = plan.weeks[0];
    const day = week.days.find((d) => d.weekday === JS_DAY[date.getDay()]);
    if (!day || day.type === "rest") continue;
    const keys = day.sections.flatMap((s) =>
      s.items.map((item) => `${s.title}::${item.name}`),
    );
    const completed =
      daysAgo === 6 ? keys.slice(0, Math.ceil(keys.length / 2)) : keys;
    logs.push({
      date: localDateString(date),
      weekLabel: week.label,
      dayTitle: day.title,
      completed,
      totalItems: keys.length,
      updatedAt: at("19:00", -daysAgo),
    });
  }
  return logs;
}

// ─── Scripture ─────────────────────────────────────────────────────────────

/** The first 30 chapters read, as if the guest has been studying for a few weeks. */
export function sampleProgress(): ScriptureProgress {
  const progress: ScriptureProgress = {};
  ALL_CHAPTERS.slice(0, 30).forEach((ch, i) => {
    progress[ch.book.slug] ??= {};
    progress[ch.book.slug][ch.chapter] = {
      completed: true,
      completedVia: "manual",
      completedAt: at("06:30", -(30 - i)),
    };
  });
  return progress;
}
