/**
 * Calendar helpers pinned to the reporting time zone (Australia/Sydney).
 *
 * Dates without a time ("local dates") are plain `YYYY-MM-DD` strings. They
 * are converted to UTC instants only at the database boundary, so week
 * buckets never depend on the server's own time zone. Weeks start on Monday.
 */

import { timezone as defaultTimezone } from "../dashboard.config.js";

const DAY_MS = 86_400_000;
const formatters = new Map();

function formatter(timezone) {
  if (!formatters.has(timezone)) {
    formatters.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return formatters.get(timezone);
}

function zonedParts(instant, timezone) {
  const parts = {};
  for (const { type, value } of formatter(timezone).formatToParts(instant)) {
    parts[type] = value;
  }
  return parts;
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
function zoneOffset(instantMs, timezone) {
  const p = zonedParts(new Date(instantMs), timezone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * @param {string|Date} instant
 * @param {string} [timezone]
 * @returns {string} local calendar date, YYYY-MM-DD
 */
export function localDate(instant, timezone = defaultTimezone) {
  const p = zonedParts(new Date(instant), timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * UTC instant of local midnight at the start of a local date.
 * Handles daylight saving changes by re-checking the offset.
 *
 * @param {string} date YYYY-MM-DD
 * @param {string} [timezone]
 * @returns {string} ISO instant
 */
export function startOfLocalDay(date, timezone = defaultTimezone) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - zoneOffset(guess, timezone);
  const corrected = guess - zoneOffset(instant, timezone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}

/** @param {string} date @param {number} days @returns {string} */
export function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Inclusive number of days from `from` to `to`. */
export function daysBetween(from, to) {
  const ms = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / DAY_MS) + 1;
}

/** Monday of the week containing a local date. */
export function weekStart(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** @param {string} value */
export function isLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Resolve the selected and comparison periods.
 * The comparison defaults to the equal-length period immediately before.
 *
 * @param {{ from?: string|null; to?: string|null; compareFrom?: string|null; compareTo?: string|null; today: string }} input
 */
export function resolvePeriods({ from, to, compareFrom, compareTo, today }) {
  const end = isLocalDate(to) ? to : today;
  const start = isLocalDate(from) ? from : weekStart(end);
  if (start > end) throw new RangeError("'from' must be on or before 'to'");
  const length = daysBetween(start, end);
  const previous =
    isLocalDate(compareFrom) && isLocalDate(compareTo) && compareFrom <= compareTo
      ? { from: compareFrom, to: compareTo }
      : { from: addDays(start, -length), to: addDays(start, -1) };
  return {
    current: { from: start, to: end, days: length, toDate: end >= today },
    previous: { ...previous, days: daysBetween(previous.from, previous.to) },
  };
}
