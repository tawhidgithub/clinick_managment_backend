import { z } from 'zod';
import { paginationQuery } from '../../shared/lib/pagination';
import { cuid, isoDate, nullableText, optionalText } from '../../shared/lib/validation';

// Multipart text fields arrive as strings; an empty date field means "not set".
const optionalFormDate = z.preprocess((v) => (v === '' ? undefined : v), isoDate.optional());

/** Text fields sent alongside the photos (multipart/form-data, files in "images"). */
export const createPrescriptionFields = z.object({
  appointmentId: cuid,
  diagnosis: optionalText(1000),
  advice: optionalText(2000),
  nextVisitDate: optionalFormDate,
});

export const updatePrescriptionBody = z.object({
  diagnosis: nullableText(1000),
  advice: nullableText(2000),
  nextVisitDate: isoDate.nullable().optional(),
});

export const listPrescriptionsQuery = paginationQuery.extend({
  patientId: cuid.optional(),
  practitionerId: cuid.optional(),
  appointmentId: cuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const imageParams = z.object({ id: cuid, imageId: cuid });

export type CreatePrescriptionFields = z.infer<typeof createPrescriptionFields>;
export type ListPrescriptionsQuery = z.infer<typeof listPrescriptionsQuery>;
