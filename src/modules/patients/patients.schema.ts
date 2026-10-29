import { z } from 'zod';
import { paginationQuery } from '../../shared/lib/pagination';
import { bdPhone, cuid, isoDate, nullableText, optionalText, queryBoolean } from '../../shared/lib/validation';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
const bloodGroup = z.enum(BLOOD_GROUPS);
const ageYears = z.number().int().min(0).max(130);

export const createPatientBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: bdPhone,
  altPhone: bdPhone.optional(),
  gender: gender.optional(),
  dateOfBirth: isoDate.optional(),
  ageYears: ageYears.optional(), // used when date of birth is unknown
  address: optionalText(300),
  bloodGroup: bloodGroup.optional(),
  notes: optionalText(1000),
});

export const updatePatientBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: bdPhone.optional(),
  altPhone: bdPhone.nullable().optional(),
  gender: gender.nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  ageYears: ageYears.nullable().optional(),
  address: nullableText(300),
  bloodGroup: bloodGroup.nullable().optional(),
  notes: nullableText(1000),
});

export const listPatientsQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  membership: z.enum(['active', 'none']).optional(),
  departmentId: cuid.optional(), // patients who have visited this department
  includeDeleted: queryBoolean.optional(), // admin only
});

export const lookupByPhoneQuery = z.object({ phone: bdPhone });

export const createNoteBody = z.object({
  body: z.string().trim().min(1, 'Note cannot be empty').max(2000),
});

export type CreatePatientBody = z.infer<typeof createPatientBody>;
export type UpdatePatientBody = z.infer<typeof updatePatientBody>;
export type ListPatientsQuery = z.infer<typeof listPatientsQuery>;
