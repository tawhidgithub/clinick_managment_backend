import { z } from 'zod';

/**
 * Bangladeshi mobile number. Accepts 01XXXXXXXXX, +8801XXXXXXXXX or
 * 8801XXXXXXXXX (spaces and dashes ignored) and normalises to 01XXXXXXXXX.
 */
export const bdPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?880/, '0'))
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, 'Phone must be in 01XXXXXXXXX format'));

/** Normalises a phone fragment for searching (digits only, 880 prefix stripped). */
export function phoneSearchDigits(input: string): string {
  return input.replace(/\D/g, '').replace(/^880/, '0');
}

export const cuid = z.string().min(1).max(64);

export const idParams = z.object({ id: cuid });

/** "YYYY-MM-DD" */
export const isoDate = z.iso.date();

/** "HH:mm", 24-hour clock */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');

/** Money in poisha: a non-negative whole number. */
export const poisha = z.number().int().min(0);

/** Optional text field that turns "" into undefined. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Nullable text for PATCH bodies: "" or null clears the field. */
export const nullableText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Query-string boolean: "true" / "false". */
export const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');
