import type { Membership, MembershipPlan, Prisma } from '@prisma/client';
import { LOCKING_TX_OPTIONS, prisma, type Tx } from '../../shared/db/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError';
import { addDays, addMonths, clinicToday, dateOnly, formatDate } from '../../shared/lib/dates';
import { nextMembershipCardNo } from '../../shared/lib/numbering';
import { paginated, toSkipTake } from '../../shared/lib/pagination';
import { phoneSearchDigits } from '../../shared/lib/validation';
import { createInvoice, getMemberDiscountRules, type PaymentInput } from '../invoices';
import { assertPatientExists } from '../patients';
import type { IssueMembershipBody, ListMembershipsQuery } from './memberships.schema';

export const EXPIRING_WITHIN_DAYS = 30;

const include = {
  patient: { select: { id: true, patientCode: true, name: true, phone: true } },
  plan: {
    select: { id: true, name: true, price: true, durationMonths: true, discountPercent: true, departmentId: true, department: { select: { name: true } } },
  },
  invoices: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true },
  },
  renewedFrom: { select: { id: true, cardNo: true, endDate: true } },
  renewedBy: { select: { id: true, cardNo: true, startDate: true } },
} satisfies Prisma.MembershipInclude;

type MembershipRow = Prisma.MembershipGetPayload<{ include: typeof include }>;

/** What staff should see, taking dates into account (the expiry job may not have run yet). */
function displayStatus(m: Pick<Membership, 'status' | 'startDate' | 'endDate'>, today = clinicToday()) {
  if (m.status !== 'ACTIVE') return m.status;
  if (m.endDate < today) return 'EXPIRED' as const;
  if (m.startDate > today) return 'UPCOMING' as const;
  return 'ACTIVE' as const;
}

function present(m: MembershipRow) {
  const today = clinicToday();
  const daysLeft = Math.round((m.endDate.getTime() - today.getTime()) / 86_400_000);
  return {
    ...m,
    displayStatus: displayStatus(m, today),
    daysLeft,
    expiringSoon: displayStatus(m, today) === 'ACTIVE' && daysLeft <= EXPIRING_WITHIN_DAYS,
  };
}

async function lockMembership(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Membership" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Membership');
  return tx.membership.findUniqueOrThrow({ where: { id }, include: { plan: true, renewedBy: { select: { id: true } } } });
}

/** Serialises membership changes for one patient (prevents double-issuing). */
async function lockPatient(tx: Tx, patientId: string) {
  await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
}

/** Creates the membership (valid start .. start + duration - 1 day) and bills it. */
async function createWithInvoice(
  tx: Tx,
  args: { patientId: string; plan: MembershipPlan; start: Date; renewedFromId?: string; payment?: PaymentInput },
  actorId: string,
) {
  const { plan, start } = args;
  const membership = await tx.membership.create({
    data: {
      cardNo: await nextMembershipCardNo(tx),
      patientId: args.patientId,
      planId: plan.id,
      startDate: start,
      endDate: addDays(addMonths(start, plan.durationMonths), -1),
      status: 'ACTIVE',
      renewedFromId: args.renewedFromId,
      createdById: actorId,
    },
  });

  await createInvoice(
    tx,
    {
      patientId: args.patientId,
      membershipId: membership.id,
      items: [
        {
          description: `${plan.name} membership · ${plan.durationMonths} month${plan.durationMonths > 1 ? 's' : ''} (${membership.cardNo})`,
          unitPrice: plan.price,
          quantity: 1,
        },
      ],
      manualDiscount: 0,
      applyMemberDiscount: false,
      payment: args.payment,
    },
    actorId,
  );
  return membership.id;
}

export async function issueMembership(body: IssueMembershipBody, actorId: string) {
  const id = await prisma.$transaction(async (tx) => {
    await assertPatientExists(tx, body.patientId);
    await lockPatient(tx, body.patientId);

    const plan = await tx.membershipPlan.findUnique({ where: { id: body.planId } });
    if (!plan) throw notFound('Membership plan');
    if (!plan.isActive) throw badRequest(`The ${plan.name} plan is no longer offered`);

    const today = clinicToday();
    const start = body.startDate ? dateOnly(body.startDate) : today;
    if (start < today) throw badRequest('Start date cannot be in the past');

    const overlapping = await tx.membership.findFirst({
      where: { patientId: body.patientId, planId: plan.id, status: 'ACTIVE', endDate: { gte: start } },
    });
    if (overlapping) {
      throw conflict(
        `This patient already has ${plan.name} (${overlapping.cardNo}) until ${formatDate(overlapping.endDate, true)}. Use Renew instead.`,
        { membershipId: overlapping.id },
      );
    }

    return createWithInvoice(tx, { patientId: body.patientId, plan, start, payment: body.payment }, actorId);
  }, LOCKING_TX_OPTIONS);
  return getMembership(id);
}

/**
 * A new membership on the same plan (at today's price and duration), starting
 * the day after the old one ends, or today if it has already expired.
 */
export async function renewMembership(id: string, payment: PaymentInput | undefined, actorId: string) {
  const newId = await prisma.$transaction(async (tx) => {
    const old = await lockMembership(tx, id);
    if (old.status === 'CANCELLED') throw conflict('A cancelled membership cannot be renewed. Issue a new one.');
    if (old.renewedBy) throw conflict('This membership has already been renewed', { membershipId: old.renewedBy.id });
    if (!old.plan.isActive) throw badRequest(`The ${old.plan.name} plan is no longer offered. Issue a different plan.`);
    await assertPatientExists(tx, old.patientId);

    const today = clinicToday();
    const dayAfterEnd = addDays(old.endDate, 1);
    const start = dayAfterEnd > today ? dayAfterEnd : today;

    return createWithInvoice(tx, { patientId: old.patientId, plan: old.plan, start, renewedFromId: old.id, payment }, actorId);
  }, LOCKING_TX_OPTIONS);
  return getMembership(newId);
}

/** Admin only. The membership's invoice is not touched; void it separately if money is returned. */
export async function cancelMembership(id: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const m = await lockMembership(tx, id);
    if (m.status !== 'ACTIVE') throw conflict(`This membership is already ${m.status.toLowerCase()}`);
    await tx.membership.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
    });
  });
  return getMembership(id);
}

export async function getMembership(id: string) {
  const m = await prisma.membership.findUnique({ where: { id }, include });
  if (!m) throw notFound('Membership');
  return present(m);
}

export async function listMemberships(query: ListMembershipsQuery) {
  const today = clinicToday();
  const soon = addDays(today, EXPIRING_WITHIN_DAYS);

  const tabWhere: Record<ListMembershipsQuery['tab'], Prisma.MembershipWhereInput> = {
    active: { status: 'ACTIVE', startDate: { lte: today }, endDate: { gte: today } },
    expiring: { status: 'ACTIVE', startDate: { lte: today }, endDate: { gte: today, lte: soon } },
    upcoming: { status: 'ACTIVE', startDate: { gt: today } },
    expired: { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', endDate: { lt: today } }] },
    cancelled: { status: 'CANCELLED' },
    all: {},
  };

  const conditions: Prisma.MembershipWhereInput[] = [tabWhere[query.tab]];
  if (query.planId) conditions.push({ planId: query.planId });
  if (query.patientId) conditions.push({ patientId: query.patientId });
  if (query.q) {
    const digits = phoneSearchDigits(query.q);
    conditions.push({
      OR: [
        { cardNo: { contains: query.q, mode: 'insensitive' } },
        { patient: { name: { contains: query.q, mode: 'insensitive' } } },
        { patient: { patientCode: { contains: query.q, mode: 'insensitive' } } },
        ...(digits.length >= 3 ? [{ patient: { phone: { contains: digits } } }] : []),
      ],
    });
  }
  const where: Prisma.MembershipWhereInput = { AND: conditions };
  const orderBy: Prisma.MembershipOrderByWithRelationInput =
    query.tab === 'expiring' ? { endDate: 'asc' } : query.tab === 'upcoming' ? { startDate: 'asc' } : { createdAt: 'desc' };

  const [rows, total] = await prisma.$transaction([
    prisma.membership.findMany({ where, include, orderBy, ...toSkipTake(query) }),
    prisma.membership.count({ where }),
  ]);
  return paginated(rows.map(present), total, query);
}

/** Memberships that give this patient a discount today (used by the invoice screen). */
export async function lookupForPatient(patientId: string) {
  await assertPatientExists(prisma, patientId);
  const memberships = await getMemberDiscountRules(prisma, patientId);
  const best = [...memberships].sort((a, b) => b.discountPercent - a.discountPercent)[0] ?? null;
  return { patientId, memberships, best };
}

/** Daily job: ACTIVE memberships past their end date become EXPIRED. */
export async function expireMemberships() {
  const result = await prisma.membership.updateMany({
    where: { status: 'ACTIVE', endDate: { lt: clinicToday() } },
    data: { status: 'EXPIRED' },
  });
  return result.count ? { expired: result.count } : undefined;
}
