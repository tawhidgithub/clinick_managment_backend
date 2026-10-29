import { z } from 'zod';
import { cuid, optionalText, poisha, queryBoolean } from '../../../shared/lib/validation';

export const createPlanBody = z.object({
  name: z.string().trim().min(1).max(80),
  price: poisha,
  durationMonths: z.number().int().min(1).max(60),
  discountPercent: z.number().int().min(0).max(100),
  departmentId: cuid.nullable().optional(), // null = all departments
  benefits: optionalText(1000),
});

export const updatePlanBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  price: poisha.optional(),
  durationMonths: z.number().int().min(1).max(60).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  departmentId: cuid.nullable().optional(),
  benefits: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listPlansQuery = z.object({ includeInactive: queryBoolean.optional() });

export type CreatePlanBody = z.infer<typeof createPlanBody>;
export type UpdatePlanBody = z.infer<typeof updatePlanBody>;
