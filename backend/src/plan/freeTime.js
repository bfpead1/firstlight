// Free time is computed here, in code, from the calendar. The AI never assigns times: it only
// ranks tasks, and fitTasks() places them into the free blocks in that order.
import { toMinutes } from "../lib/time.js";

/**
 * Task sizes. The minutes are used only to decide what fits in a free block; they are never
 * shown as estimates.
 */
export const SIZE_MINUTES = { quick: 20, medium: 60, long: 120 };
export const SIZES = Object.keys(SIZE_MINUTES);

/** The size bucket for a known duration (workout, scripture study). */
export function sizeForMinutes(minutes) {
  return minutes <= 30 ? "quick" : minutes <= 90 ? "medium" : "long";
}

const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Gaps in the day not covered by timed events.
 * @param events     [{ start: "HH:MM", end: "HH:MM" }] timed events (any order, may overlap)
 * @param dayStart   first usable minute of the day, "HH:MM"
 * @param dayEnd     last usable minute, "HH:MM"
 * @param notBefore  "HH:MM": nothing earlier (e.g. the current time when planning mid-day)
 * @param bufferMin  kept free after each event (travel, transition)
 * @param minBlock   shorter gaps are dropped
 * @returns [{ start, end, minutes }]
 */
export function freeBlocks({ events, dayStart = "06:00", dayEnd = "22:00", notBefore = null, bufferMin = 5, minBlock = 20 }) {
  let cursor = Math.max(toMinutes(dayStart), notBefore ? roundUp(toMinutes(notBefore), 5) : 0);
  const end = toMinutes(dayEnd);
  const busy = events
    .map((e) => [toMinutes(e.start), Math.min(toMinutes(e.end) + bufferMin, 24 * 60)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const blocks = [];
  const push = (s, e) => {
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

function roundUp(m, step) {
  return Math.ceil(m / step) * step;
}

/**
 * Places tasks into free blocks in priority order, earliest block first. A task that doesn't
 * fit whole in any block is split across blocks only when it's "long"; otherwise, or when
 * there isn't enough free time left, it goes to `unscheduled`.
 * @param blocks [{ start, end, minutes }]
 * @param tasks  [{ id, size, minutes? }] in priority order; `minutes` overrides the size (known durations)
 * @returns { blocks: [{ start, end, minutes, items: [{ task_id, part, parts }] }], unscheduled: [task_id] }
 */
export function fitTasks(blocks, tasks, { minChunk = 20 } = {}) {
  const out = blocks.map((b) => ({ ...b, items: [], left: b.minutes }));
  const unscheduled = [];

  for (const task of tasks) {
    const need = task.minutes ?? SIZE_MINUTES[task.size] ?? SIZE_MINUTES.medium;
    const whole = out.find((b) => b.left >= need);
    if (whole) {
      whole.items.push({ task_id: task.id, part: 1, parts: 1 });
      whole.left -= need;
      continue;
    }
    if (task.size !== "long") {
      unscheduled.push(task.id);
      continue;
    }
    // Long task: spread over the earliest blocks with room, if the total is enough.
    const usable = out.filter((b) => b.left >= minChunk);
    if (usable.reduce((n, b) => n + b.left, 0) < need) {
      unscheduled.push(task.id);
      continue;
    }
    let remaining = need;
    const chunks = [];
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
