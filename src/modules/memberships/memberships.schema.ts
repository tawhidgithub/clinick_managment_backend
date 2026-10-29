import { z } from 'zod';
import { paginationQuery } from '../../shared/lib/pagination';
import { cuid, isoDate } from '../../shared/lib/validation';
import { paymentInput } from '../invoices';

export const issueMembershipBody = z.object({
  patientId: cuid,
  planId: cuid,
  startDate: isoDate.optional(), // defaults to today; may be in the future
  payment: paymentInput.optional(), // pay now (full or part) or leave the invoice due
});

export const renewMembershipBody = z.object({
  payment: paymentInput.optional(),
});

export const cancelMembershipBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason for cancelling').max(300),
});

export const MEMBERSHIP_TABS = ['active', 'expiring', 'upcoming', 'expired', 'cancelled', 'all'] as const;

export const listMembershipsQuery = paginationQuery.extend({
  tab: z.enum(MEMBERSHIP_TABS).default('active'),
  planId: cuid.optional(),
  patientId: cuid.optional(),
  q: z.string().trim().max(100).optional(), // card no, patient name / ID / phone
});

export const lookupQuery = z.object({ patientId: cuid });

export type IssueMembershipBody = z.infer<typeof issueMembershipBody>;
export type ListMembershipsQuery = z.infer<typeof listMembershipsQuery>;
