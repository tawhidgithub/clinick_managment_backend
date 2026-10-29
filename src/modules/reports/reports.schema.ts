import { z } from 'zod';
import { isoDate } from '../../shared/lib/validation';

export const MAX_REPORT_DAYS = 3 * 366;

export const reportQuery = z
  .object({
    // Clinic days, inclusive. Default: the 1st of this month to today.
    from: isoDate.optional(),
    to: isoDate.optional(),
    // Chart buckets. Default: day for ranges up to 62 days, month beyond.
    groupBy: z.enum(['day', 'month']).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ['from'] });

export type ReportQuery = z.infer<typeof reportQuery>;
