// Business rules 3 & 4: invoice totals, membership discount and status.
import type { InvoiceStatus } from '@prisma/client';
import type { Db } from '../../shared/db/prisma';
import { badRequest } from '../../shared/errors/AppError';
import { clinicToday } from '../../shared/lib/dates';
import { formatTaka, percentOf } from '../../shared/lib/money';

export interface InvoiceLine {
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number; // poisha
  lineTotal: number; // poisha
  departmentId: string | null; // decides which membership discounts apply
}

export interface DiscountRule {
  membershipId: string;
  cardNo: string;
  planName: string;
  discountPercent: number;
  departmentId: string | null; // null = all departments
  endDate: Date;
}

/**
 * The patient's memberships that are valid on `onDate` (checked by date, not
 * only by status, so a late expiry job never gives a wrong discount).
 * Reads the Membership table directly (allowed: read-only) to avoid a module cycle.
 */
export async function getMemberDiscountRules(db: Db, patientId: string, onDate = clinicToday()): Promise<DiscountRule[]> {
  const memberships = await db.membership.findMany({
    where: { patientId, status: 'ACTIVE', startDate: { lte: onDate }, endDate: { gte: onDate } },
    include: { plan: { select: { name: true, discountPercent: true, departmentId: true } } },
  });
  return memberships.map((m) => ({
    membershipId: m.id,
    cardNo: m.cardNo,
    planName: m.plan.name,
    discountPercent: m.plan.discountPercent,
    departmentId: m.plan.departmentId,
    endDate: m.endDate,
  }));
}

export interface InvoiceTotals {
  subtotal: number;
  memberDiscount: number;
  memberDiscountNote: string | null;
  manualDiscount: number;
  total: number;
}

/**
 * subtotal = sum of line totals.
 * member discount = for each line, the best plan that covers its department
 *   (plans with no department cover everything), rounded down to whole poisha.
 * total = subtotal - member discount - manual discount (never below zero; a
 *   manual discount larger than what is left is rejected rather than clipped).
 */
export function computeTotals(lines: InvoiceLine[], rules: DiscountRule[], manualDiscount: number): InvoiceTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  let memberDiscount = 0;
  const used = new Map<string, DiscountRule>();
  for (const line of lines) {
    const best = rules
      .filter((r) => r.departmentId === null || r.departmentId === line.departmentId)
      .sort((a, b) => b.discountPercent - a.discountPercent)[0];
    if (best && best.discountPercent > 0) {
      memberDiscount += percentOf(line.lineTotal, best.discountPercent);
      used.set(best.membershipId, best);
    }
  }

  const afterMember = subtotal - memberDiscount;
  if (manualDiscount > afterMember) {
    throw badRequest(`Manual discount cannot be more than ${formatTaka(afterMember)}`);
  }

  const memberDiscountNote = memberDiscount
    ? [...used.values()].map((r) => `${r.planName} ${r.discountPercent}% · ${r.cardNo}`).join(', ')
    : null;

  return { subtotal, memberDiscount, memberDiscountNote, manualDiscount, total: afterMember - manualDiscount };
}

/** Business rule 4. A ৳0 invoice (fully discounted) counts as PAID. */
export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (total === 0 || paid >= total) return 'PAID';
  if (paid === 0) return 'DUE';
  return 'PARTIAL';
}
