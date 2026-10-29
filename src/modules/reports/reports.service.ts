import { Prisma, type AppointmentStatus, type PaymentMethod } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../shared/db/prisma';
import { badRequest } from '../../shared/errors/AppError';
import { clinicDayRange, clinicDayStart, clinicToday, dateOnly, toDateString } from '../../shared/lib/dates';
import { MAX_REPORT_DAYS, type ReportQuery } from './reports.schema';

/** SUM()/COUNT() come back from Postgres as bigint. */
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * A timestamp column holds UTC wall time without a zone. Comparing it with a
 * UTC instant this way does not depend on the database session's time zone.
 */
const utc = (at: Date) => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** The clinic-local bucket ("2026-10-22" or "2026-10") of a UTC timestamp column. */
const localBucket = (column: Prisma.Sql, format: string) =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${env.APP_TIMEZONE}, ${format})`;

const KIND_SQL = Prisma.sql`CASE WHEN i."appointmentId" IS NOT NULL THEN 'visit' WHEN i."membershipId" IS NOT NULL THEN 'membership' ELSE 'other' END`;
type InvoiceKind = 'visit' | 'membership' | 'other';

interface MoneyRow {
  kind: InvoiceKind;
  departmentId: string | null;
  practitionerId: string | null;
  invoices: number;
  billed: bigint;
  discounts: bigint;
  due: bigint;
}
interface CollectedRow {
  kind: InvoiceKind;
  departmentId: string | null;
  practitionerId: string | null;
  collected: bigint;
}

function resolveRange(query: ReportQuery) {
  const today = toDateString(clinicToday());
  const from = query.from ?? `${today.slice(0, 8)}01`;
  const to = query.to ?? (from > today ? from : today);
  if (from > to) throw badRequest('"from" must be on or before "to"');
  const days = Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000) + 1;
  if (days > MAX_REPORT_DAYS) throw badRequest(`A report can cover at most ${MAX_REPORT_DAYS} days`);
  const groupBy = query.groupBy ?? (days <= 62 ? 'day' : 'month');
  return { from, to, days, groupBy };
}

/** Every bucket key between from and to, so charts have no gaps. */
function bucketKeys(from: string, to: string, groupBy: 'day' | 'month') {
  const keys: string[] = [];
  if (groupBy === 'day') {
    for (let d = dateOnly(from); d <= dateOnly(to); d = new Date(d.getTime() + 86_400_000)) keys.push(toDateString(d));
  } else {
    let [y, m] = from.split('-').map(Number) as [number, number];
    const end = to.slice(0, 7);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      keys.push(key);
      if (key >= end) break;
      if (++m > 12) [y, m] = [y + 1, 1];
    }
  }
  return keys;
}

/**
 * Clinic report for a date range (Admin).
 *
 * - billed: totals of non-void invoices created in the range (after discounts).
 * - collected: money received in the range, net of refunds, whenever the invoice was made.
 * - Visit invoices are credited to the visit's department and doctor; membership
 *   and stand-alone invoices get their own rows.
 * - Service amounts in topServices are before discounts.
 */
export async function getReport(query: ReportQuery) {
  const range = resolveRange(query);
  const { from, to, groupBy } = range;
  const gte = clinicDayStart(from);
  const lt = clinicDayStart(to, 1);
  const createdInRange = clinicDayRange(from, to)!;
  const fmt = groupBy === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';

  const [
    invoiceSums,
    voided,
    moneyRows,
    collectedRows,
    received,
    refunded,
    visitGroups,
    topServices,
    billedSeries,
    collectedSeries,
    visitSeries,
    newPatients,
    membershipGroups,
    renewals,
    dueAging,
    largestDues,
    departments,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: { not: 'VOID' }, createdAt: createdInRange },
      _count: true,
      _sum: { subtotal: true, memberDiscount: true, manualDiscount: true, total: true, paidAmount: true },
    }),
    prisma.invoice.aggregate({ where: { status: 'VOID', createdAt: createdInRange }, _count: true, _sum: { total: true } }),
    prisma.$queryRaw<MoneyRow[]>`
      SELECT ${KIND_SQL} AS kind, a."departmentId", a."practitionerId",
             COUNT(*)::int AS invoices,
             COALESCE(SUM(i.total), 0)::bigint AS billed,
             COALESCE(SUM(i."memberDiscount" + i."manualDiscount"), 0)::bigint AS discounts,
             COALESCE(SUM(i.total - i."paidAmount"), 0)::bigint AS due
      FROM "Invoice" i LEFT JOIN "Appointment" a ON a.id = i."appointmentId"
      WHERE i.status <> 'VOID' AND i."createdAt" >= ${utc(gte)} AND i."createdAt" < ${utc(lt)}
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<CollectedRow[]>`
      SELECT ${KIND_SQL} AS kind, a."departmentId", a."practitionerId",
             COALESCE(SUM(p.amount), 0)::bigint AS collected
      FROM "Payment" p
      JOIN "Invoice" i ON i.id = p."invoiceId"
      LEFT JOIN "Appointment" a ON a.id = i."appointmentId"
      WHERE p."paidAt" >= ${utc(gte)} AND p."paidAt" < ${utc(lt)}
      GROUP BY 1, 2, 3`,
    prisma.payment.groupBy({ by: ['method'], where: { paidAt: createdInRange, amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ['method'], where: { paidAt: createdInRange, amount: { lt: 0 } }, _sum: { amount: true }, _count: true }),
    prisma.appointment.groupBy({
      by: ['departmentId', 'practitionerId', 'status'],
      where: { visitDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      _count: true,
    }),
    prisma.$queryRaw<
      Array<{ serviceId: string | null; name: string | null; departmentId: string | null; quantity: number; amount: bigint; invoices: number }>
    >`
      SELECT it."serviceId", s.name, s."departmentId",
             SUM(it.quantity)::int AS quantity,
             COALESCE(SUM(it."lineTotal"), 0)::bigint AS amount,
             COUNT(DISTINCT it."invoiceId")::int AS invoices
      FROM "InvoiceItem" it
      JOIN "Invoice" i ON i.id = it."invoiceId"
      LEFT JOIN "Service" s ON s.id = it."serviceId"
      WHERE i.status <> 'VOID' AND i."membershipId" IS NULL
        AND i."createdAt" >= ${utc(gte)} AND i."createdAt" < ${utc(lt)}
      GROUP BY it."serviceId", s.name, s."departmentId"
      ORDER BY amount DESC
      LIMIT 10`,
    prisma.$queryRaw<Array<{ bucket: string; billed: bigint; invoices: number }>>`
      SELECT ${localBucket(Prisma.sql`i."createdAt"`, fmt)} AS bucket,
             COALESCE(SUM(i.total), 0)::bigint AS billed, COUNT(*)::int AS invoices
      FROM "Invoice" i
      WHERE i.status <> 'VOID' AND i."createdAt" >= ${utc(gte)} AND i."createdAt" < ${utc(lt)}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ bucket: string; collected: bigint }>>`
      SELECT ${localBucket(Prisma.sql`p."paidAt"`, fmt)} AS bucket, COALESCE(SUM(p.amount), 0)::bigint AS collected
      FROM "Payment" p
      WHERE p."paidAt" >= ${utc(gte)} AND p."paidAt" < ${utc(lt)}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ bucket: string; visits: number; completed: number }>>`
      SELECT to_char(a."visitDate", ${fmt}) AS bucket,
             (COUNT(*) FILTER (WHERE a.status <> 'CANCELLED'))::int AS visits,
             (COUNT(*) FILTER (WHERE a.status = 'COMPLETED'))::int AS completed
      FROM "Appointment" a
      WHERE a."visitDate" >= ${from}::date AND a."visitDate" <= ${to}::date
      GROUP BY 1`,
    prisma.patient.count({ where: { createdAt: createdInRange, deletedAt: null } }),
    prisma.membership.groupBy({ by: ['planId'], where: { createdAt: createdInRange }, _count: true }),
    prisma.membership.count({ where: { createdAt: createdInRange, renewedFromId: { not: null } } }),
    // Everything still owed today, by age of the invoice (not limited to the range)
    prisma.$queryRaw<Array<{ bucket: string; invoices: number; amount: bigint }>>`
      SELECT CASE WHEN age_days <= 7 THEN '0-7' WHEN age_days <= 30 THEN '8-30'
                  WHEN age_days <= 90 THEN '31-90' ELSE '90+' END AS bucket,
             COUNT(*)::int AS invoices, COALESCE(SUM(due), 0)::bigint AS amount
      FROM (
        SELECT i.total - i."paidAmount" AS due,
               EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - i."createdAt")) / 86400 AS age_days
        FROM "Invoice" i
        WHERE i.status IN ('DUE', 'PARTIAL')
      ) open_invoices
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT i.id FROM "Invoice" i
      WHERE i.status IN ('DUE', 'PARTIAL')
      ORDER BY i.total - i."paidAmount" DESC, i."createdAt" ASC
      LIMIT 10`,
    prisma.department.findMany({ select: { id: true, name: true, code: true, color: true, isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  // ── Names for ids found in the data ──────────────────────────────────────
  const practitionerIds = new Set<string>();
  for (const r of [...moneyRows, ...collectedRows]) if (r.practitionerId) practitionerIds.add(r.practitionerId);
  for (const g of visitGroups) practitionerIds.add(g.practitionerId);

  const [practitioners, plans, largestRows] = await Promise.all([
    prisma.practitioner.findMany({ where: { id: { in: [...practitionerIds] } }, select: { id: true, name: true, departmentId: true } }),
    prisma.membershipPlan.findMany({ where: { id: { in: membershipGroups.map((g) => g.planId) } }, select: { id: true, name: true } }),
    prisma.invoice.findMany({
      where: { id: { in: largestDues.map((r) => r.id) } },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        total: true,
        paidAmount: true,
        createdAt: true,
        patient: { select: { id: true, patientCode: true, name: true, phone: true } },
      },
    }),
  ]);
  const deptById = new Map(departments.map((d) => [d.id, d]));

  // ── Revenue by department (+ memberships, other) ─────────────────────────
  type RevenueRow = { invoices: number; billed: number; discounts: number; due: number; collected: number };
  const emptyRevenue = (): RevenueRow => ({ invoices: 0, billed: 0, discounts: 0, due: 0, collected: 0 });
  const revenue = new Map<string, RevenueRow>();
  const byDoctor = new Map<string, RevenueRow>();
  const keyOf = (r: { kind: InvoiceKind; departmentId: string | null }) => (r.kind === 'visit' ? r.departmentId! : r.kind);
  const bump = (map: Map<string, RevenueRow>, key: string) => map.get(key) ?? map.set(key, emptyRevenue()).get(key)!;

  for (const r of moneyRows) {
    for (const row of [bump(revenue, keyOf(r)), ...(r.practitionerId ? [bump(byDoctor, r.practitionerId)] : [])]) {
      row.invoices += r.invoices;
      row.billed += num(r.billed);
      row.discounts += num(r.discounts);
      row.due += num(r.due);
    }
  }
  for (const r of collectedRows) {
    bump(revenue, keyOf(r)).collected += num(r.collected);
    if (r.practitionerId) bump(byDoctor, r.practitionerId).collected += num(r.collected);
  }

  const revenueByDepartment = [
    ...departments
      .filter((d) => d.isActive || revenue.has(d.id))
      .map((d) => ({ key: d.id, department: { id: d.id, name: d.name, code: d.code, color: d.color }, label: d.name, ...(revenue.get(d.id) ?? emptyRevenue()) })),
    { key: 'membership', department: null, label: 'Memberships', ...(revenue.get('membership') ?? emptyRevenue()) },
    ...(revenue.has('other') ? [{ key: 'other', department: null, label: 'Other', ...revenue.get('other')! }] : []),
  ];

  // ── Visits by department and by doctor ───────────────────────────────────
  type VisitCounts = Record<'total' | 'completed' | 'noShow' | 'cancelled' | 'open', number>;
  const emptyVisits = (): VisitCounts => ({ total: 0, completed: 0, noShow: 0, cancelled: 0, open: 0 });
  const addVisits = (c: VisitCounts, status: AppointmentStatus, count: number) => {
    if (status === 'CANCELLED') c.cancelled += count;
    else {
      c.total += count; // cancelled visits are not counted as visits
      if (status === 'COMPLETED') c.completed += count;
      else if (status === 'NO_SHOW') c.noShow += count;
      else c.open += count; // still booked / waiting / in room
    }
  };
  const visitsByDept = new Map<string, VisitCounts>();
  const visitsByDoctor = new Map<string, VisitCounts>();
  for (const g of visitGroups) {
    const d = visitsByDept.get(g.departmentId) ?? visitsByDept.set(g.departmentId, emptyVisits()).get(g.departmentId)!;
    const p = visitsByDoctor.get(g.practitionerId) ?? visitsByDoctor.set(g.practitionerId, emptyVisits()).get(g.practitionerId)!;
    addVisits(d, g.status, g._count);
    addVisits(p, g.status, g._count);
  }

  const appointmentsByDepartment = departments
    .filter((d) => d.isActive || visitsByDept.has(d.id))
    .map((d) => ({ department: { id: d.id, name: d.name, code: d.code, color: d.color }, ...(visitsByDept.get(d.id) ?? emptyVisits()) }));

  const doctorRows = practitioners
    .map((p) => {
      const dept = deptById.get(p.departmentId);
      const visits = visitsByDoctor.get(p.id) ?? emptyVisits();
      const money = byDoctor.get(p.id) ?? emptyRevenue();
      return {
        practitioner: { id: p.id, name: p.name },
        department: dept ? { id: dept.id, name: dept.name, color: dept.color } : null,
        visits: visits.total,
        completed: visits.completed,
        noShow: visits.noShow,
        cancelled: visits.cancelled,
        billed: money.billed,
        collected: money.collected,
      };
    })
    .sort((a, b) => b.billed - a.billed || b.visits - a.visits);

  // ── Time series ──────────────────────────────────────────────────────────
  const billedBy = new Map(billedSeries.map((r) => [r.bucket, r]));
  const collectedBy = new Map(collectedSeries.map((r) => [r.bucket, num(r.collected)]));
  const visitsBy = new Map(visitSeries.map((r) => [r.bucket, r]));
  const series = bucketKeys(from, to, groupBy).map((bucket) => ({
    bucket,
    billed: num(billedBy.get(bucket)?.billed),
    invoices: billedBy.get(bucket)?.invoices ?? 0,
    collected: collectedBy.get(bucket) ?? 0,
    visits: visitsBy.get(bucket)?.visits ?? 0,
    completed: visitsBy.get(bucket)?.completed ?? 0,
  }));

  // ── Payment methods ──────────────────────────────────────────────────────
  const methods = new Map<PaymentMethod, { method: PaymentMethod; received: number; refunded: number; payments: number }>();
  const method = (m: PaymentMethod) => methods.get(m) ?? methods.set(m, { method: m, received: 0, refunded: 0, payments: 0 }).get(m)!;
  for (const r of received) Object.assign(method(r.method), { received: r._sum.amount ?? 0, payments: r._count });
  for (const r of refunded) method(r.method).refunded = -(r._sum.amount ?? 0);
  const paymentMethods = [...methods.values()]
    .map((m) => ({ ...m, net: m.received - m.refunded }))
    .sort((a, b) => b.net - a.net);
  const totalReceived = paymentMethods.reduce((s, m) => s + m.received, 0);
  const totalRefunded = paymentMethods.reduce((s, m) => s + m.refunded, 0);

  // ── Dues ─────────────────────────────────────────────────────────────────
  const AGING = ['0-7', '8-30', '31-90', '90+'] as const;
  const agingBy = new Map(dueAging.map((r) => [r.bucket, r]));
  const aging = AGING.map((bucket) => ({ days: bucket, invoices: agingBy.get(bucket)?.invoices ?? 0, amount: num(agingBy.get(bucket)?.amount) }));
  const largestById = new Map(largestRows.map((r) => [r.id, r]));

  const visitTotals = [...visitsByDept.values()].reduce((sum, c) => {
    for (const k of Object.keys(sum) as Array<keyof VisitCounts>) sum[k] += c[k];
    return sum;
  }, emptyVisits());
  const planNames = new Map(plans.map((p) => [p.id, p.name]));
  const membershipRevenue = revenue.get('membership') ?? emptyRevenue();

  return {
    range,
    summary: {
      invoices: invoiceSums._count,
      subtotal: invoiceSums._sum.subtotal ?? 0,
      memberDiscount: invoiceSums._sum.memberDiscount ?? 0,
      manualDiscount: invoiceSums._sum.manualDiscount ?? 0,
      billed: invoiceSums._sum.total ?? 0,
      // still owed on invoices created in this range
      due: (invoiceSums._sum.total ?? 0) - (invoiceSums._sum.paidAmount ?? 0),
      received: totalReceived,
      refunded: totalRefunded,
      collected: totalReceived - totalRefunded,
      voidedInvoices: voided._count,
      voidedAmount: voided._sum.total ?? 0,
      visits: visitTotals.total,
      completedVisits: visitTotals.completed,
      noShows: visitTotals.noShow,
      cancelledVisits: visitTotals.cancelled,
      newPatients,
    },
    series,
    revenueByDepartment,
    appointmentsByDepartment,
    practitioners: doctorRows,
    topServices: topServices.map((s) => ({
      service: s.serviceId ? { id: s.serviceId, name: s.name } : null,
      label: s.name ?? 'Custom items',
      department: s.departmentId ? (deptById.get(s.departmentId) ?? null) : null,
      quantity: s.quantity,
      invoices: s.invoices,
      grossAmount: num(s.amount),
    })),
    paymentMethods,
    memberships: {
      sold: membershipGroups.reduce((s, g) => s + g._count, 0),
      renewals,
      billed: membershipRevenue.billed,
      collected: membershipRevenue.collected,
      byPlan: membershipGroups
        .map((g) => ({ plan: { id: g.planId, name: planNames.get(g.planId) ?? 'Unknown plan' }, count: g._count }))
        .sort((a, b) => b.count - a.count),
    },
    // Owed today on all open invoices, whenever they were created
    dues: {
      total: aging.reduce((s, a) => s + a.amount, 0),
      invoices: aging.reduce((s, a) => s + a.invoices, 0),
      aging,
      largest: largestDues
        .map((r) => largestById.get(r.id))
        .filter((r) => r !== undefined)
        .map((r) => ({ ...r, due: r.total - r.paidAmount })),
    },
  };
}
