import { z } from 'zod';
import { cuid, poisha, queryBoolean } from '../../shared/lib/validation';

export const createServiceBody = z.object({
  name: z.string().trim().min(1).max(120),
  departmentId: cuid,
  price: poisha, // poisha
});

export const updateServiceBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  price: poisha.optional(),
  isActive: z.boolean().optional(),
});

export const listServicesQuery = z.object({
  departmentId: cuid.optional(),
  q: z.string().trim().max(100).optional(),
  includeInactive: queryBoolean.optional(),
});

export type CreateServiceBody = z.infer<typeof createServiceBody>;
export type UpdateServiceBody = z.infer<typeof updateServiceBody>;
export type ListServicesQuery = z.infer<typeof listServicesQuery>;
