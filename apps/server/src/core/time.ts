/**
 * Instants on disk (SPEC.md §5). Corpus writes ISO-8601 UTC at second precision
 * — `2026-07-19T10:05:00Z` — because turn timestamps double as turn identity
 * (§6) and appear verbatim in `## user · <ts>` headings, so a stable textual
 * form matters more than sub-second resolution.
 *
 * Hand-written files are read leniently (offsets, milliseconds, lowercase `t`/`z`
 * are all accepted) and normalized *in memory*. Normalization only reaches disk
 * when the field is actually rewritten — reading a document never rewrites it.
 */

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Lenient on read, strict on write. Accepts a date-only value (`2026-07-19`),
 * an optional seconds component, optional fractional seconds, and either `Z` or
 * a numeric UTC offset. A bare local date-time (no zone) is rejected: guessing
 * the writer's timezone would silently shift instants.
 */
const LENIENT_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|z|[+-]\d{2}:?\d{2}))?$/;

/** Calendar dates carry no time component (`due`, SPEC.md §5). */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

/**
 * `Date.parse` silently rolls impossible dates over — `2026-02-30` becomes
 * March 2 — so the calendar is checked component-wise before any parse.
 */
const isRealCalendarDate = (year: string, month: string, day: string): boolean => {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
};

const isRealTimeOfDay = (hour: string, minute: string, second: string): boolean =>
  Number(hour) < HOURS_PER_DAY &&
  Number(minute) < MINUTES_PER_HOUR &&
  Number(second) < SECONDS_PER_MINUTE;

/** The canonical written form: UTC, second precision. */
export const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The current instant in canonical form. */
export const nowIso = (): string => formatInstant(Date.now());

/** Format epoch milliseconds as a canonical instant, truncating sub-second precision. */
export const formatInstant = (epochMs: number): string => {
  const truncated = Math.floor(epochMs / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND;
  return `${new Date(truncated).toISOString().slice(0, 19)}Z`;
};

/**
 * Normalize a hand-written instant to canonical form, or `null` when the value
 * is not an instant at all. A date-only value is read as that day's midnight UTC.
 */
export const normalizeInstant = (value: string): string | null => {
  const match = LENIENT_INSTANT.exec(value.trim());
  if (match === null) return null;
  const [, year = "", month = "", day = "", hour = "00", minute = "00", second = "00", zone = "Z"] =
    match;
  if (!isRealCalendarDate(year, month, day) || !isRealTimeOfDay(hour, minute, second)) return null;
  // `+0200` is a legal YAML/ISO offset but `Date.parse` only accepts `+02:00`.
  const utcOffset = zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone.toUpperCase();
  const epochMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${utcOffset}`);
  return Number.isNaN(epochMs) ? null : formatInstant(epochMs);
};

/**
 * Normalize a calendar date, or `null` when the value is not one. Unlike
 * instants, dates have no zone to reconcile — only the shape and the calendar
 * validity are checked.
 */
export const normalizeCalendarDate = (value: string): string | null => {
  const match = CALENDAR_DATE.exec(value.trim());
  if (match === null) return null;
  const [date, year = "", month = "", day = ""] = match;
  return isRealCalendarDate(year, month, day) ? date : null;
};

/** Epoch milliseconds for a canonical or hand-written instant; `null` when unparseable. */
export const instantToEpochMs = (value: string): number | null => {
  const normalized = normalizeInstant(value);
  return normalized === null ? null : Date.parse(normalized);
};

/** The instant one second after `value`, in canonical form. */
export const nextSecond = (value: string): string => {
  const epochMs = instantToEpochMs(value);
  if (epochMs === null) throw new TypeError(`Not an ISO-8601 instant: ${value}`);
  return formatInstant(epochMs + MILLISECONDS_PER_SECOND);
};
