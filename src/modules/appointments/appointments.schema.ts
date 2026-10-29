import { z } from 'zod';
import { paginationQuery } from '../../shared/lib/pagination';
import { cuid, isoDate, optionalText, queryBoolean } from '../../shared/lib/validation';

export const APPOINTMENT_STATUSES = ['BOOKED', 'WAITING', 'IN_ROOM', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
const status = z.enum(APPOINTMENT_STATUSES);

/** One service line chosen for a visit. */
export const visitServiceLine = z.object({
  serviceId: cuid,
  quantity: z.number().int().min(1).max(50).default(1),
});

export const serviceLines = z
  .array(visitServiceLine)
  .min(1, 'Choose at least one service')
  .max(20)
  .refine((lines) => new Set(lines.map((l) => l.serviceId)).size === lines.length, {
    message: 'Each service can be added only once (use quantity instead)',
  });

export const listAppointmentsQuery = paginationQuery.extend({
  date: isoDate.optional(), // one clinic day
  from: isoDate.optional(), // or a range (inclusive)
  to: isoDate.optional(),
  departmentId: cuid.optional(),
  practitionerId: cuid.optional(),
  patientId: cuid.optional(),
  // comma-separated, e.g. "WAITING,IN_ROOM"
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
    .pipe(z.array(status).optional()),
  // completed visits that have no (non-void) invoice yet
  unbilled: queryBoolean.optional(),
});

export const cancelAppointmentBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason for cancelling').max(300),
});

export const replaceServicesBody = z.object({ services: serviceLines });

export const createTreatmentBody = z.object({
  serviceId: cuid.optional(),
  description: z.string().trim().min(1).max(1000),
  toothOrArea: optionalText(100),
});

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuery>;
export type ServiceLine = z.infer<typeof visitServiceLine>;
export type CreateTreatmentBody = z.infer<typeof createTreatmentBody>;
