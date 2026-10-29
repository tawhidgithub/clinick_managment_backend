import { env } from '../../config/env';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "YYYY-MM-DD" for the given instant, in the clinic's time zone. */
export function clinicDateString(at: Date = new Date()): string {
  return dayFormatter.format(at); // en-CA formats as YYYY-MM-DD
}

/**
 * The clinic-local calendar day as a Date at UTC midnight, which is what
 * Prisma expects for `@db.Date` columns. Using `new Date()` directly would
 * roll the day over at 06:00 Dhaka time (UTC midnight).
 */
export function clinicToday(at: Date = new Date()): Date {
  return dateOnly(clinicDateString(at));
}

/** Parses "YYYY-MM-DD" into a Date at UTC midnight for `@db.Date` columns. */
export function dateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

/** Formats a `@db.Date` value back to "YYYY-MM-DD". */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: env.APP_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Milliseconds the clinic's wall clock is ahead of UTC at the given instant. */
function clinicOffsetMs(at: Date): number {
  const p = Object.fromEntries(offsetFormatter.formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - at.getTime();
}

/**
 * The UTC instant at which a clinic day ("YYYY-MM-DD") starts, i.e. 00:00 in
 * APP_TIMEZONE. Use for filtering timestamp columns (createdAt, paidAt) by day.
 */
export function clinicDayStart(day: string, offsetDays = 0): Date {
  const midnightUtc = new Date(dateOnly(day).getTime() + offsetDays * 86_400_000);
  return new Date(midnightUtc.getTime() - clinicOffsetMs(midnightUtc));
}

/** `{ gte, lt }` filter covering clinic days from..to (inclusive) on a timestamp column. */
export function clinicDayRange(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: clinicDayStart(from) } : {}),
    ...(to ? { lt: clinicDayStart(to, 1) } : {}),
  };
}

/** Adds whole days to a `@db.Date` value. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Adds calendar months to a `@db.Date` value, clamping to the last day of the
 * month (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
 */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

const displayDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: env.APP_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const displayDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: env.APP_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "22 Oct 2026". Pass `dateOnlyValue` for `@db.Date` columns (already a calendar day). */
export function formatDate(date: Date, dateOnlyValue = false): string {
  return dateOnlyValue
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(date)
    : displayDate.format(date);
}

/** "22 Oct 2026, 11:40 am" in clinic time. */
export function formatDateTime(date: Date): string {
  return displayDateTime.format(date);
}

export function clinicYear(at: Date = new Date()): number {
  return Number(clinicDateString(at).slice(0, 4));
}

/** Whole years between a date of birth and today (clinic time). */
export function ageFromDateOfBirth(dateOfBirth: Date, today: Date = clinicToday()): number {
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(age, 0);
}
