import { z } from 'zod';
import { cuid, isoDate } from '../../shared/lib/validation';

export const boardQuery = z.object({
  date: isoDate.optional(), // defaults to today (clinic time)
  departmentId: cuid.optional(),
});

export const practitionerParams = z.object({ practitionerId: cuid });
export const appointmentParams = z.object({ appointmentId: cuid });

export const nextBody = z.object({
  // The appointment the desk sees IN_ROOM (null = doctor looked free).
  // Omit only from tools like Postman; the frontend should always send it.
  expectedCurrentAppointmentId: cuid.nullable().optional(),
  // false = finish the current patient without calling anyone (doctor on break)
  callNext: z.boolean().default(true),
});

export const skipBody = z.object({
  action: z.enum(['NO_SHOW', 'MOVE_TO_END']),
});

export type BoardQuery = z.infer<typeof boardQuery>;
