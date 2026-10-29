import { z } from 'zod';
import { paginationQuery } from '../../shared/lib/pagination';
import { cuid, isoDate } from '../../shared/lib/validation';

export const listAuditQuery = paginationQuery.extend({
  entityType: z.string().trim().max(50).optional(), // "invoices", "patients", ...
  entityId: cuid.optional(),
  actorId: cuid.optional(),
  action: z.string().trim().max(100).optional(), // part of "POST /invoices/:id/void"
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type ListAuditQuery = z.infer<typeof listAuditQuery>;
