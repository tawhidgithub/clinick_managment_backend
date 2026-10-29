import type { Prisma } from '@prisma/client';
import { LOCKING_TX_OPTIONS, prisma, type Tx } from '../../shared/db/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError';
import { clinicDayRange } from '../../shared/lib/dates';
import { formatTaka } from '../../shared/lib/money';
import { nextInvoiceNo } from '../../shared/lib/numbering';
import { paginated, toSkipTake } from '../../shared/lib/pagination';
import { phoneSearchDigits } from '../../shared/lib/validation';
import { lockAppointmentForBilling } from '../appointments';
import { assertPatientExists } from '../patients';
import { getActiveServices } from '../services';
import type { InvoiceItemInput, ListInvoicesQuery, PaymentInput } from './invoices.schema';
import { computeTotals, getMemberDiscountRules, invoiceStatus, type InvoiceLine } from './invoices.totals';

type BillingAppointment = Awaited<ReturnType<typeof lockAppointmentForBilling>>;

export interface InvoiceDraftInput {
  appointmentId?: string;
  patientId?: string;
  membershipId?: string;
  items?: InvoiceItemInput[];
  manualDiscount: number;
  applyMemberDiscount: boolean;
}

// ─── Draft (shared by preview, create and edit) ─────────────────────────────

async function resolveLines(tx: Tx, items: InvoiceItemInput[] | undefined, appt: BillingAppointment | null) {
  if (!items) {
    if (!appt) throw badRequest('An invoice without a visit needs items');
    if (appt.services.length === 0) throw badRequest('This visit has no services. Add items to the invoice.');
    return appt.services.map<InvoiceLine>((s) => ({
      serviceId: s.serviceId,
      description: s.service.name,
      quantity: s.quantity,
      unitPrice: s.price, // price booked at the visit
      lineTotal: s.price * s.quantity,
      departmentId: appt.departmentId,
    }));
  }

  const serviceIds = items.flatMap((i) => (i.serviceId ? [i.serviceId] : []));
  const services = serviceIds.length ? await getActiveServices(tx, serviceIds) : [];
  const byId = new Map(services.map((s) => [s.id, s]));

  return items.map<InvoiceLine>((i) => {
    const service = i.serviceId ? byId.get(i.serviceId)! : null;
    const unitPrice = i.unitPrice ?? service!.price;
    return {
      serviceId: service?.id ?? null,
      description: i.description ?? service!.name,
      quantity: i.quantity,
      unitPrice,
      lineTotal: unitPrice * i.quantity,
      departmentId: service?.departmentId ?? appt?.departmentId ?? null,
    };
  });
}

async function buildDraft(tx: Tx, input: InvoiceDraftInput, opts: { forExistingInvoiceId?: string } = {}) {
  let appt: BillingAppointment | null = null;
  let patientId = input.patientId;

  if (input.appointmentId) {
    appt = await lockAppointmentForBilling(tx, input.appointmentId);
    if (appt.status === 'CANCELLED' || appt.status === 'NO_SHOW') {
      throw conflict(`A ${appt.status === 'CANCELLED' ? 'cancelled' : 'no-show'} visit cannot be billed`);
    }
    const live = appt.invoices.find((i) => i.id !== opts.forExistingInvoiceId);
    if (live) {
      throw conflict(`This visit already has invoice ${live.invoiceNo}. Void it first to bill again.`, {
        invoiceId: live.id,
      });
    }
    if (patientId && patientId !== appt.patientId) throw badRequest('patientId does not match the visit');
    patientId = appt.patientId;
  } else {
    await assertPatientExists(tx, patientId!);
  }

  const lines = await resolveLines(tx, input.items, appt);
  const rules = input.applyMemberDiscount ? await getMemberDiscountRules(tx, patientId!) : [];
  const totals = computeTotals(lines, rules, input.manualDiscount);

  return { patientId: patientId!, appt, lines, totals, availableMemberships: rules };
}

/** Totals for the Create invoice screen without saving anything. */
export async function previewInvoice(input: InvoiceDraftInput) {
  return prisma.$transaction(async (tx) => {
    const { patientId, lines, totals, availableMemberships } = await buildDraft(tx, input);
    return { patientId, items: lines, ...totals, availableMemberships };
  }, LOCKING_TX_OPTIONS);
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Creates an invoice (and an optional first payment) inside the caller's
 * transaction. Public: memberships use it to bill a plan purchase.
 */
export async function createInvoice(
  tx: Tx,
  input: InvoiceDraftInput & { payment?: PaymentInput },
  actorId: string,
): Promise<string> {
  const { patientId, appt, lines, totals } = await buildDraft(tx, input);

  const invoice = await tx.invoice.create({
    data: {
      invoiceNo: await nextInvoiceNo(tx),
      patientId,
      appointmentId: appt?.id,
      membershipId: input.membershipId,
      ...totals,
      paidAmount: 0,
      status: invoiceStatus(totals.total, 0),
      createdById: actorId,
      items: {
        create: lines.map(({ departmentId: _d, ...line }) => line),
      },
    },
  });

  if (input.payment) await recordPaymentInTx(tx, invoice.id, input.payment, actorId);
  return invoice.id;
}

export async function createInvoiceAndLoad(input: InvoiceDraftInput & { payment?: PaymentInput }, actorId: string) {
  const id = await prisma.$transaction((tx) => createInvoice(tx, input, actorId), LOCKING_TX_OPTIONS);
  return getInvoice(id);
}

// ─── Payments ───────────────────────────────────────────────────────────────

async function lockInvoice(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Invoice');
  return tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: { include: { service: true } } } });
}

async function recordPaymentInTx(tx: Tx, invoiceId: string, payment: PaymentInput, actorId: string) {
  const invoice = await lockInvoice(tx, invoiceId);
  if (invoice.status === 'VOID') throw conflict('This invoice has been voided');

  const due = invoice.total - invoice.paidAmount;
  if (due <= 0) throw conflict('This invoice is already fully paid');
  if (payment.amount > due) {
    throw badRequest(`Payment is more than the amount due (${formatTaka(due)})`, { due });
  }

  const paidAmount = invoice.paidAmount + payment.amount;
  await tx.payment.create({
    data: { invoiceId, amount: payment.amount, method: payment.method, reference: payment.reference, receivedById: actorId },
  });
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount, status: invoiceStatus(invoice.total, paidAmount) },
  });
}

export async function addPayment(invoiceId: string, payment: PaymentInput, actorId: string) {
  await prisma.$transaction((tx) => recordPaymentInTx(tx, invoiceId, payment, actorId), LOCKING_TX_OPTIONS);
  return getInvoice(invoiceId);
}

// ─── Edit & void ────────────────────────────────────────────────────────────

/**
 * Business rule 5: only an unpaid (DUE, nothing received) invoice can be
 * edited. Paid or partly paid invoices must be voided and recreated.
 */
export async function updateInvoice(
  id: string,
  body: { items?: InvoiceItemInput[]; manualDiscount?: number; applyMemberDiscount?: boolean },
) {
  await prisma.$transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.status === 'VOID') throw conflict('A voided invoice cannot be edited');
    if (invoice.paidAmount > 0) {
      throw conflict('Money has been received on this invoice. Void it and create a new one instead.');
    }
    if (invoice.membershipId) throw conflict('Membership invoices cannot be edited');

    // Without new items, keep the current lines.
    const items: InvoiceItemInput[] =
      body.items ??
      invoice.items.map((i) => ({
        serviceId: i.serviceId ?? undefined,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      }));

    const { lines, totals } = await buildDraft(
      tx,
      {
        appointmentId: invoice.appointmentId ?? undefined,
        patientId: invoice.patientId,
        items,
        manualDiscount: body.manualDiscount ?? invoice.manualDiscount,
        applyMemberDiscount: body.applyMemberDiscount ?? invoice.memberDiscount > 0,
      },
      { forExistingInvoiceId: id },
    );

    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.update({
      where: { id },
      data: {
        ...totals,
        status: invoiceStatus(totals.total, 0),
        items: { create: lines.map(({ departmentId: _d, ...line }) => line) },
      },
    });
  }, LOCKING_TX_OPTIONS);
  return getInvoice(id);
}

/**
 * Admin only. Marks the invoice VOID and, if money was received, records a
 * refund (a negative payment) so collection reports stay correct. The visit
 * can then be billed again.
 */
export async function voidInvoice(id: string, reason: string, refundMethod: PaymentInput['method'], actorId: string) {
  await prisma.$transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.status === 'VOID') throw conflict('This invoice is already void');

    if (invoice.paidAmount > 0) {
      await tx.payment.create({
        data: {
          invoiceId: id,
          amount: -invoice.paidAmount,
          method: refundMethod,
          note: `Refund on void: ${reason}`,
          receivedById: actorId,
        },
      });
    }
    await tx.invoice.update({
      where: { id },
      data: { status: 'VOID', voidReason: reason, voidedAt: new Date(), voidedById: actorId, paidAmount: 0 },
    });
  }, LOCKING_TX_OPTIONS);
  return getInvoice(id);
}

// ─── Read ───────────────────────────────────────────────────────────────────

const detailInclude = {
  patient: { select: { id: true, patientCode: true, name: true, phone: true, address: true } },
  appointment: {
    select: {
      id: true,
      serialNo: true,
      visitDate: true,
      department: { select: { id: true, name: true, color: true } },
      practitioner: { select: { id: true, name: true, title: true } },
    },
  },
  membership: { select: { id: true, cardNo: true, startDate: true, endDate: true, plan: { select: { name: true } } } },
  items: { orderBy: { id: 'asc' as const } },
  payments: { orderBy: { paidAt: 'asc' as const }, include: { receivedBy: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
} satisfies Prisma.InvoiceInclude;

export async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: detailInclude });
  if (!invoice) throw notFound('Invoice');
  return { ...invoice, due: invoice.status === 'VOID' ? 0 : invoice.total - invoice.paidAmount };
}

export async function listInvoices(query: ListInvoicesQuery) {
  const conditions: Prisma.InvoiceWhereInput[] = [];
  if (query.status) conditions.push({ status: { in: query.status } });
  if (query.patientId) conditions.push({ patientId: query.patientId });
  if (query.departmentId) conditions.push({ appointment: { departmentId: query.departmentId } });
  if (query.kind === 'visit') conditions.push({ appointmentId: { not: null } });
  if (query.kind === 'membership') conditions.push({ membershipId: { not: null } });
  if (query.kind === 'other') conditions.push({ appointmentId: null, membershipId: null });
  // Dates are clinic days: from 00:00 of `from` to the end of `to`, clinic time.
  const created = clinicDayRange(query.from, query.to);
  if (created) conditions.push({ createdAt: created });
  if (query.q) {
    const digits = phoneSearchDigits(query.q);
    conditions.push({
      OR: [
        { invoiceNo: { contains: query.q, mode: 'insensitive' } },
        { patient: { name: { contains: query.q, mode: 'insensitive' } } },
        { patient: { patientCode: { contains: query.q, mode: 'insensitive' } } },
        ...(digits.length >= 3 ? [{ patient: { phone: { contains: digits } } }] : []),
      ],
    });
  }
  const where: Prisma.InvoiceWhereInput = { AND: conditions };

  const [rows, total, sums] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
      include: {
        patient: { select: { id: true, patientCode: true, name: true, phone: true } },
        appointment: { select: { id: true, serialNo: true, department: { select: { id: true, name: true, color: true } } } },
        membership: { select: { id: true, cardNo: true } },
      },
    }),
    prisma.invoice.count({ where }),
    // Totals row ignores void invoices.
    prisma.invoice.aggregate({ where: { AND: [...conditions, { status: { not: 'VOID' } }] }, _sum: { total: true, paidAmount: true } }),
  ]);

  const totalAmount = sums._sum.total ?? 0;
  const paidAmount = sums._sum.paidAmount ?? 0;
  return {
    ...paginated(
      rows.map((r) => ({ ...r, due: r.status === 'VOID' ? 0 : r.total - r.paidAmount })),
      total,
      query,
    ),
    totals: { total: totalAmount, paid: paidAmount, due: totalAmount - paidAmount },
  };
}

