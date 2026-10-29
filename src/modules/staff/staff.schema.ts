import { z } from 'zod';
import { cuid } from '../../shared/lib/validation';
import { passwordRule } from '../auth';

const role = z.enum(['ADMIN', 'FRONT_DESK', 'PRACTITIONER']);

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'Username: 3-30 characters, letters, numbers, . _ -');

export const createStaffBody = z.object({
  name: z.string().trim().min(1).max(120),
  username,
  password: passwordRule,
  role,
  practitionerId: cuid.optional(),
});

export const updateStaffBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: role.optional(),
  isActive: z.boolean().optional(),
  practitionerId: cuid.nullable().optional(), // null unlinks
});

export const resetPasswordBody = z.object({ newPassword: passwordRule });

export type CreateStaffBody = z.infer<typeof createStaffBody>;
export type UpdateStaffBody = z.infer<typeof updateStaffBody>;
