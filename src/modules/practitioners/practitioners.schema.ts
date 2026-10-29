import { z } from 'zod';
import { bdPhone, cuid, optionalText, queryBoolean, timeOfDay } from '../../shared/lib/validation';

export const scheduleEntry = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday
    startTime: timeOfDay,
    endTime: timeOfDay,
  })
  .refine((s) => s.startTime < s.endTime, { message: 'End time must be after start time', path: ['endTime'] });

export const replaceSchedulesBody = z
  .object({ schedules: z.array(scheduleEntry).max(50) })
  .superRefine(({ schedules }, ctx) => {
    // No two blocks on the same day may overlap ("HH:mm" strings compare correctly).
    for (let i = 0; i < schedules.length; i++) {
      for (let j = i + 1; j < schedules.length; j++) {
        const a = schedules[i]!;
        const b = schedules[j]!;
        if (a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime) {
          ctx.addIssue({
            code: 'custom',
            message: `Schedule blocks ${i + 1} and ${j + 1} overlap`,
            path: ['schedules', j],
          });
        }
      }
    }
  });

export const createPractitionerBody = z.object({
  name: z.string().trim().min(1).max(120),
  title: optionalText(120),
  phone: bdPhone.optional(),
  departmentId: cuid,
  slotMinutes: z.number().int().min(5).max(240).default(30),
});

export const updatePractitionerBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  phone: bdPhone.nullable().optional(),
  departmentId: cuid.optional(),
  slotMinutes: z.number().int().min(5).max(240).optional(),
  isActive: z.boolean().optional(),
});

export const listPractitionersQuery = z.object({
  departmentId: cuid.optional(),
  includeInactive: queryBoolean.optional(),
});

export type CreatePractitionerBody = z.infer<typeof createPractitionerBody>;
export type UpdatePractitionerBody = z.infer<typeof updatePractitionerBody>;
export type ReplaceSchedulesBody = z.infer<typeof replaceSchedulesBody>;
export type ListPractitionersQuery = z.infer<typeof listPractitionersQuery>;
