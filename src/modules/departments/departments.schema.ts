import { z } from 'zod';
import { queryBoolean } from '../../shared/lib/validation';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #2563EB');

export const createDepartmentBody = z.object({
  name: z.string().trim().min(1).max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, 'Code must be 2-5 letters, e.g. PHY'),
  color: hexColor,
});

export const updateDepartmentBody = createDepartmentBody.partial().extend({
  isActive: z.boolean().optional(),
});

export const listDepartmentsQuery = z.object({
  includeInactive: queryBoolean.optional(),
});

export type CreateDepartmentBody = z.infer<typeof createDepartmentBody>;
export type UpdateDepartmentBody = z.infer<typeof updateDepartmentBody>;
