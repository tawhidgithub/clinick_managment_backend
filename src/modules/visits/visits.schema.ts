import { z } from 'zod';
import { cuid, optionalText } from '../../shared/lib/validation';
import { serviceLines } from '../appointments';
import { createPatientBody } from '../patients';

/**
 * New Visit form, saved in one go. Send `patientId` for an existing patient
 * (picked from the phone lookup) or `newPatient` to register one.
 */
export const createVisitBody = z
  .object({
    patientId: cuid.optional(),
    newPatient: createPatientBody.optional(),
    departmentId: cuid,
    practitionerId: cuid,
    services: serviceLines,
    reason: optionalText(300),
  })
  .refine((b) => Boolean(b.patientId) !== Boolean(b.newPatient), {
    message: 'Send either patientId (existing patient) or newPatient, not both',
    path: ['patientId'],
  });

export type CreateVisitBody = z.infer<typeof createVisitBody>;
