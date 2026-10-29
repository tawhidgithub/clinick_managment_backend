import { z } from 'zod';
import { paginationQuery } from '../../shared/lib/pagination';
import { cuid, isoDate, optionalText, poisha } from '../../shared/lib/validation';

export const PAYMENT_METHODS = ['CASH', 'BKASH', 'NAGAD', 'CARD', 'BANK'] as const;
export const INVOICE_STATUSES = ['DUE', 'PARTIAL', 'PAID', 'VOID'] as const;

/**
 * One invoice line. With `serviceId`, description and price default to the
 * service's; without it, a custom line needs both.
 */
export const invoiceItemInput = z
  .object({
    serviceId: cuid.optional(),
    description: optionalText(200),
    quantity: z.number().int().min(1).max(100).default(1),
    unitPrice: poisha.optional(),
  })
  .refine((i) => i.serviceId || (i.description && i.unitPrice !== undefined), {
    message: 'A custom item needs a description and a unitPrice',
  });

export const paymentInput = z.object({
  amount: z.number().int().min(1, 'Amount must be at least 1 poisha'),
  method: z.enum(PAYMENT_METHODS).default('CASH'),
  reference: optionalText(100), // bKash/Nagad TrxID, card slip no.
});

const invoiceDraftShape = {
  appointmentId: cuid.optional(),
  patientId: cuid.optional(), // required when there is no appointment
  // Omit to bill the services chosen for the visit.
  items: z.array(invoiceItemInput).min(1).max(50).optional(),
  manualDiscount: poisha.default(0),
  applyMemberDiscount: z.boolean().default(true),
};

const draftRefinements = <T extends z.ZodType<{ appointmentId?: string; patientId?: string; items?: unknown[] }>>(s: T) =>
  s
    .refine((b) => b.appointmentId || b.patientId, { message: 'Send appointmentId or patientId', path: ['patientId'] })
    .refine((b) => b.appointmentId || b.items, { message: 'An invoice without a visit needs items', path: ['items'] });

export const previewInvoiceBody = draftRefinements(z.object(invoiceDraftShape));

export const createInvoiceBody = draftRefinements(
  z.object({ ...invoiceDraftShape, payment: paymentInput.optional() }),
);

export const updateInvoiceBody = z.object({
  items: z.array(invoiceItemInput).min(1).max(50).optional(),
  manualDiscount: poisha.optional(),
  applyMemberDiscount: z.boolean().optional(),
});

export const voidInvoiceBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason for voiding').max(300),
  // How money already paid is returned to the patient
  refundMethod: z.enum(PAYMENT_METHODS).default('CASH'),
});

export const listInvoicesQuery = paginationQuery.extend({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
    .pipe(z.array(z.enum(INVOICE_STATUSES)).optional()),
  from: isoDate.optional(),
  to: isoDate.optional(),
  departmentId: cuid.optional(),
  patientId: cuid.optional(),
  kind: z.enum(['visit', 'membership', 'other']).optional(),
  q: z.string().trim().max(100).optional(), // invoice no, patient name / ID / phone
});

export const pdfQuery = z.object({
  paper: z.enum(['a4', 'a5']).default('a5'),
  download: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

export type InvoiceItemInput = z.infer<typeof invoiceItemInput>;
export type PaymentInput = z.infer<typeof paymentInput>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuery>;
